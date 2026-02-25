import { spawn, type Subprocess } from "bun";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Webtty, State } from "../websocket/websocket";

const CACHE_PATH = process.env.THONNY_CACHE || join(homedir(), ".thonny", "cache");
const ASSET_PATH = join(CACHE_PATH, "asset");

const PYTHON_CANDIDATES =
    process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

async function findPythonPath(): Promise<string> {
    if (process.platform === "win32") {
        for (const candidate of PYTHON_CANDIDATES) {
            try {
                const proc = spawn({
                    cmd: ["where", candidate],
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const text = await new Response(proc.stdout).text();
                const exitCode = await proc.exited;
                if (exitCode === 0 && text.trim()) {
                    const path = text.trim().split("\n")[0].trim();
                    console.log(`找到Python位于: ${path}`);
                    return path;
                }
            } catch {
                continue;
            }
        }
    } else {
        for (const candidate of PYTHON_CANDIDATES) {
            try {
                const proc = spawn({
                    cmd: ["which", candidate],
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const text = await new Response(proc.stdout).text();
                const exitCode = await proc.exited;
                if (exitCode === 0 && text.trim()) {
                    return text.trim();
                }
            } catch {
                continue;
            }
        }
    }
    return "python";
}

interface RunnerOptions {
    pythonPath?: string;
    cachePath?: string;
    webtty?: Webtty;
}

export class Runner {
    private webtty: Webtty | null = null;
    private mainIsRunning = false;
    private lastWebttyState = State.WAIT;
    private pythonProcess: Subprocess | null = null;
    private pythonPath: string;
    private cachePath: string;
    private currentWorkDir: string | null = null;
    private checkInterval: Timer | null = null;
    private pythonDetected = false;
    private processReady = false;
    private pendingInputs: string[] = [];

    constructor(options: RunnerOptions = {}) {
        this.pythonPath = options.pythonPath || "python";
        this.cachePath = options.cachePath || CACHE_PATH;
        this.webtty = options.webtty || null;
    }

    async detectPython(): Promise<string> {
        if (this.pythonDetected) {
            return this.pythonPath;
        }
        this.pythonPath = await findPythonPath();
        this.pythonDetected = true;
        console.log(`已检测到Python: ${this.pythonPath}`);
        return this.pythonPath;
    }

    setWebtty(webtty: Webtty): void {
        this.webtty = webtty;
    }

    start(): void {
        this.checkInterval = setInterval(() => this.checkState(), 100);
        console.log("Python运行器已启动");
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.closeBackend();
        console.log("运行停止");
    }

    private checkState(): void {
        if (!this.webtty) return;

        if (this.webtty.getState() === State.READY) {
            if (!this.mainIsRunning) {
                this.mainIsRunning = true;
                this.processReady = false;
                this.recvAndRun();
            } else if (this.processReady) {
                while (true) {
                    const inputValue = this.webtty.fetchNextInput();
                    if (inputValue !== undefined) {
                        this.sendProgramInput(inputValue);
                    } else {
                        break;
                    }
                }
            }
        } else {
            if (this.lastWebttyState === State.READY) {
                this.restartBackend();
                this.mainIsRunning = false;
                this.processReady = false;
            }
            this.webtty.poxyReady();
        }
        this.lastWebttyState = this.webtty.getState();
    }

    private async recvAndRun(): Promise<void> {
        if (!this.webtty || this.webtty.getState() !== State.READY) {
            this.mainIsRunning = false;
            return;
        }

        const [code, pathId, _firstMsg] = this.webtty.getCodeAndPath();
        if (!code || !pathId) {
            this.mainIsRunning = false;
            return;
        }

        const projectPath = join(ASSET_PATH, String(pathId));
        const filePath = join(projectPath, "main.py");

        const createResult = await this.createFile(filePath, code);
        if (createResult !== true) {
            this.webtty.sendMsg({
                inner_err: "资源创建失败，请刷新后页面",
            });
            this.mainIsRunning = false;
            return;
        }

        this.currentWorkDir = projectPath;
        await this.runPython(filePath, projectPath, this.webtty);
    }

    private async runPython(filePath: string, workDir: string, webtty: Webtty): Promise<void> {
        try {
            await this.detectPython();

            this.pythonProcess = spawn({
                cmd: [this.pythonPath, "-u", filePath],
                cwd: workDir,
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
                env: {
                    ...process.env,
                    PYTHONIOENCODING: "utf-8",
                    PYTHONUTF8: "1",
                },
            });

            this.processReady = true;
            while (this.pendingInputs.length > 0) {
                const input = this.pendingInputs.shift()!;
                this.sendProgramInput(input);
            }

            const stdoutReader = this.pythonProcess.stdout.getReader();
            const stderrReader = this.pythonProcess.stderr.getReader();

            const readOutput = async (
                reader: ReadableStreamDefaultReader<Uint8Array>,
                isError: boolean,
            ) => {
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value, { stream: true });
                    const output = text.replace(/\n/g, "\r\n");

                    webtty.sendMsg({
                        type: "BackendEvent",
                        data: isError ? `[stderr] ${output}` : output,
                    });
                }
            };

            Promise.all([readOutput(stdoutReader, false), readOutput(stderrReader, true)])
                .then(async () => {
                    if (this.pythonProcess) {
                        const exitCode = await this.pythonProcess.exited;
                        webtty.sendMsg({
                            command_name: "Run",
                        });
                        console.log(`Python程序退出，退出码 ${exitCode}`);
                        this.pythonProcess = null;
                        this.mainIsRunning = false;
                        this.processReady = false;
                    }
                })
                .catch((error) => {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    webtty.sendMsg({
                        inner_err: `运行错误: ${errMsg}`,
                    });
                    this.pythonProcess = null;
                    this.mainIsRunning = false;
                    this.processReady = false;
                });
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            webtty.sendMsg({
                inner_err: `运行错误: ${errMsg}`,
            });
            this.pythonProcess = null;
            this.mainIsRunning = false;
            this.processReady = false;
        }
    }

    sendProgramInput(data: string): void {
        if (this.pythonProcess && this.pythonProcess.stdin) {
            this.pythonProcess.stdin.write(new TextEncoder().encode(data + "\n"));
        } else if (!this.processReady) {
            this.pendingInputs.push(data);
        }
    }

    private async createFile(fileName: string, content: string | Buffer): Promise<boolean | Error> {
        try {
            const dir = join(fileName, "..");
            if (!existsSync(dir)) {
                await mkdir(dir, { recursive: true });
            }

            if (content instanceof Buffer) {
                await writeFile(fileName, content);
            } else {
                await writeFile(fileName, content, "utf-8");
            }
            return true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error("Create file error:", err);
            return err;
        }
    }

    private restartBackend(): void {
        this.closeBackend();
    }

    private closeBackend(): void {
        if (this.pythonProcess) {
            this.pythonProcess.kill();
            this.pythonProcess = null;
        }
    }

    interrupt(): void {
        if (this.pythonProcess) {
            this.pythonProcess.kill();
        }
    }
}

let _runner: Runner | null = null;

export function getRunner(): Runner | null {
    return _runner;
}

export function startRunner(options?: RunnerOptions): Runner {
    if (_runner) {
        _runner.stop();
    }
    _runner = new Runner(options);
    _runner.start();
    return _runner;
}

export function stopRunner(): void {
    if (_runner) {
        _runner.stop();
        _runner = null;
    }
}
