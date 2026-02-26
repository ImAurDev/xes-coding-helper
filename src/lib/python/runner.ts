import { file, spawn, type Subprocess } from "bun";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import path, { join } from "path";
import { homedir } from "os";
import { Webtty, State } from "../websocket/websocket";

const CACHE_PATH = process.env.THONNY_CACHE || join(homedir(), ".thonny", "cache");
const ASSET_PATH = join(CACHE_PATH, "asset");
const CONFIG_PATH = join(CACHE_PATH, "config.json");

const PYTHON_CANDIDATES =
    process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

interface Config {
    pythonPath?: string;
}

async function loadConfig(): Promise<Config> {
    try {
        if (existsSync(CONFIG_PATH)) {
            const data = await readFile(CONFIG_PATH, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("加载配置失败:", e);
    }
    return {};
}

async function saveConfig(config: Config): Promise<void> {
    try {
        const dir = join(CONFIG_PATH, "..");
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
        await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    } catch (e) {
        console.error("保存配置失败:", e);
    }
}

async function getSavedPythonPath(): Promise<string | undefined> {
    const config = await loadConfig();
    return config.pythonPath;
}

async function savePythonPath(path: string): Promise<void> {
    await saveConfig({ pythonPath: path });
}

async function findAllPythonPaths(): Promise<string[]> {
    const paths: string[] = [];
    const seen = new Set<string>();

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
                    const lines = text.trim().split("\n");
                    for (const line of lines) {
                        const path = line.trim();
                        if (path && !seen.has(path.toLowerCase())) {
                            seen.add(path.toLowerCase());
                            paths.push(path);
                        }
                    }
                }
            } catch {
                continue;
            }
        }

        const commonPaths = [
            "C:\\Python312\\python.exe",
            "C:\\Python311\\python.exe",
            "C:\\Python310\\python.exe",
            "C:\\Python39\\python.exe",
            "C:\\Program Files\\Python312\\python.exe",
            "C:\\Program Files\\Python311\\python.exe",
            "C:\\Program Files\\Python310\\python.exe",
        ];
        for (const p of commonPaths) {
            if (existsSync(p) && !seen.has(p.toLowerCase())) {
                seen.add(p.toLowerCase());
                paths.push(p);
            }
        }
    } else {
        for (const candidate of PYTHON_CANDIDATES) {
            try {
                const proc = spawn({
                    cmd: ["which", "-a", candidate],
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const text = await new Response(proc.stdout).text();
                const exitCode = await proc.exited;
                if (exitCode === 0 && text.trim()) {
                    const lines = text.trim().split("\n");
                    for (const line of lines) {
                        const path = line.trim();
                        if (path && !seen.has(path)) {
                            seen.add(path);
                            paths.push(path);
                        }
                    }
                }
            } catch {
                continue;
            }
        }

        const commonPaths = [
            "/usr/bin/python3",
            "/usr/local/bin/python3",
            "/opt/python3/bin/python3",
        ];
        for (const p of commonPaths) {
            if (existsSync(p) && !seen.has(p)) {
                seen.add(p);
                paths.push(p);
            }
        }
    }

    return paths;
}

async function findPythonPath(): Promise<string> {
    const savedPath = await getSavedPythonPath();
    if (savedPath && existsSync(savedPath)) {
        console.log(`使用已保存的Python路径: ${savedPath}`);
        return savedPath;
    }

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
        const runWithAutoInstall = async (retryCount: number = 0): Promise<void> => {
            const maxRetries = 1;
            
            await this.detectPython();   
            const fileName = path.basename(filePath);

            this.pythonProcess = spawn({
                cmd: [this.pythonPath, "-u", fileName],
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
            
            let stderrBuffer = "";

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

                    if (isError) {
                        stderrBuffer += text;
                    }

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
                        
                        if (exitCode !== 0 && retryCount < maxRetries) {
                            const moduleMatch = stderrBuffer.match(/ModuleNotFoundError: No module named '([^']+)'/);
                            if (moduleMatch) {
                                const moduleName = moduleMatch[1];
                                const moduleMap: Record<string, string> = {
                                    'pgzrun': 'pgzero',
                                    'PIL': 'Pillow',
                                    'cv2': 'opencv-python',
                                    'sklearn': 'scikit-learn',
                                    'nx': 'networkx',
                                    'plt': 'matplotlib',
                                    'sp': 'scipy',
                                    'md': 'markdown',
                                    'yaml': 'pyyaml',
                                    'jieba': 'jieba',
                                    'bs4': 'beautifulsoup4',
                                    'grpc': 'grpcio',
                                    'tensorflow': 'tensorflow',
                                    'torch': 'torch',
                                    ' telegram': 'python-telegram-bot',
                                    'telebot': 'pyTelegramBotAPI',
                                    'aiogram': 'aiogram',
                                    'discord': 'discord.py',
                                    'vk_api': 'vk-api',
                                    'qrcode': 'qrcode[pil]',
                                    'PIL.Image': 'Pillow',
                                };
                                
                                let installName = moduleName;
                                if (moduleMap[moduleName]) {
                                    installName = moduleMap[moduleName];
                                }
                                
                                webtty.sendMsg({
                                    type: "BackendEvent",
                                    data: `[stderr] 正在自动安装缺失模块: ${installName}...\r\n`,
                                });
                                
                                try {
                                    const installProc = spawn({
                                        cmd: [
                                            this.pythonPath, "-m", "pip", "install", 
                                            installName, 
                                            "--no-cache-dir",
                                            "--no-warn-script-location"
                                        ],
                                        stdout: "pipe",
                                        stderr: "pipe",
                                    });
                                    
                                    const installStdoutReader = installProc.stdout.getReader();
                                    const installStderrReader = installProc.stderr.getReader();
                                    const decoder = new TextDecoder();
                                    
                                    const readInstallOutput = async (
                                        reader: ReadableStreamDefaultReader<Uint8Array>,
                                        isError: boolean
                                    ) => {
                                        while (true) {
                                            const { done, value } = await reader.read();
                                            if (done) break;
                                            const text = decoder.decode(value, { stream: true });
                                            const lines = text.split('\n').filter(line => line.trim());
                                            for (const line of lines) {
                                                if (line.includes('Collecting') || line.includes('Downloading') || 
                                                    line.includes('Installing') || line.includes('Successfully') ||
                                                    line.includes('%')) {
                                                    webtty.sendMsg({
                                                        type: "BackendEvent",
                                                        data: `[stderr] ${line}\r\n`,
                                                    });
                                                }
                                            }
                                        }
                                    };
                                    
                                    await Promise.all([
                                        readInstallOutput(installStdoutReader, false),
                                        readInstallOutput(installStderrReader, true)
                                    ]);
                                    
                                    const installExitCode = await installProc.exited;
                                    
                                    if (installExitCode === 0) {
                                        webtty.sendMsg({
                                            type: "BackendEvent",
                                            data: `[stderr] 模块 ${installName} 安装完成，正在重新运行...\r\n`,
                                        });
                                        
                                        this.pythonProcess = null;
                                        this.processReady = false;
                                        await runWithAutoInstall(retryCount + 1);
                                        return;
                                    } else {
                                        webtty.sendMsg({
                                            type: "BackendEvent",
                                            data: `[stderr] 自动安装 ${installName} 失败\r\n`,
                                        });
                                    }
                                } catch (installError) {
                                    const errMsg = installError instanceof Error ? installError.message : String(installError);
                                    webtty.sendMsg({
                                        type: "BackendEvent",
                                        data: `[stderr] 自动安装 ${installName} 失败: ${errMsg}\r\n`,
                                    });
                                }
                            }
                        }
                        
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
        };

        try {
            await runWithAutoInstall(0);
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

export { findAllPythonPaths, getSavedPythonPath, savePythonPath };
