import { spawn } from "bun";
import { readFile, writeFile, mkdir, readdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface Mirror {
    name: string;
    mirror: string;
}

export interface ProcessInfo {
    name: string;
    progress: number;
    state: "installing" | "installed" | "error" | "waiting";
    msg: string;
}

export class PackageManager {
    private mirrors: Mirror[] = [
        { name: "默认", mirror: "https://mirrors.aliyun.com/pypi/simple/" },
        { name: "清华", mirror: "https://pypi.tuna.tsinghua.edu.cn/simple" },
        { name: "豆瓣", mirror: "https://pypi.douban.com/simple/" },
        { name: "Python 官方", mirror: "https://pypi.org/simple" },
    ];
    private mirrorIndex = 0;
    private pythonPath: string = "python";
    private userLibPath: string;
    private currentProcess: ReturnType<typeof spawn> | null = null;
    private processQueue: string[] = [];
    private currentInstalling: string | null = null;
    private onProgressCallback: ((info: ProcessInfo) => void) | null = null;

    constructor() {
        this.userLibPath = join(homedir(), ".thonny", "lib");
    }

    async init(): Promise<void> {
        this.pythonPath = await this.findPython();
        if (!existsSync(this.userLibPath)) {
            await mkdir(this.userLibPath, { recursive: true });
        }
    }

    private async findPython(): Promise<string> {
        const candidates = process.platform === "win32"
            ? ["python", "py", "python3"]
            : ["python3", "python"];

        for (const candidate of candidates) {
            try {
                const proc = spawn({
                    cmd: process.platform === "win32" 
                        ? ["where", candidate] 
                        : ["which", candidate],
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const text = await new Response(proc.stdout).text();
                const exitCode = await proc.exited;
                if (exitCode === 0 && text.trim()) {
                    return text.trim().split("\n")[0].trim();
                }
            } catch {
                continue;
            }
        }
        return "python";
    }

    setProgressCallback(callback: (info: ProcessInfo) => void): void {
        this.onProgressCallback = callback;
    }

    private notifyProgress(info: ProcessInfo): void {
        if (this.onProgressCallback) {
            this.onProgressCallback(info);
        }
    }

    getMirrors(): { mirrors: Mirror[]; currentIndex: number } {
        return {
            mirrors: this.mirrors,
            currentIndex: this.mirrorIndex,
        };
    }

    setMirrorIndex(index: number): void {
        this.mirrorIndex = index;
    }

    async getLocalList(needAll: boolean = false): Promise<{ user: any[]; lib: any[] }> {
        const userList = await this.listPackages(this.userLibPath);

        if (!needAll) {
            return { user: userList, lib: [] };
        }

        const libList: any[] = [];
        return { user: userList, lib: libList };
    }

    private async listPackages(libPath: string): Promise<any[]> {
        try {
            const proc = spawn({
                cmd: [
                    this.pythonPath, "-m", "pip", "list",
                    "--path", libPath,
                    "--format", "json"
                ],
                stdout: "pipe",
                stderr: "pipe",
            });

            const stdout = await new Response(proc.stdout).text();
            await proc.exited;

            if (stdout.trim()) {
                return JSON.parse(stdout);
            }
            return [];
        } catch (error) {
            console.error("Failed to list packages:", error);
            return [];
        }
    }

    async getModuleInfo(packageName: string): Promise<any> {
        try {
            const proc = spawn({
                cmd: [
                    this.pythonPath, "-m", "pip", "show", packageName
                ],
                stdout: "pipe",
                stderr: "pipe",
            });

            const stdout = await new Response(proc.stdout).text();
            await proc.exited;

            const info: any = {};
            for (const line of stdout.split("\n")) {
                const [key, ...valueParts] = line.split(":");
                if (key && valueParts.length > 0) {
                    info[key.trim()] = valueParts.join(":").trim();
                }
            }
            return info;
        } catch {
            return {};
        }
    }

    async handleInstall(pack: { name: string; version?: string; url?: string; pip_source?: string }): Promise<void> {
        if (this.currentProcess) {
            this.processQueue.push(pack.name);
            this.notifyProgress({
                name: pack.name,
                progress: 0,
                state: "waiting",
                msg: "等待中",
            });
            return;
        }

        this.currentInstalling = pack.name;
        this.notifyProgress({
            name: pack.name,
            progress: 0,
            state: "installing",
            msg: "开始安装",
        });

        try {
            const args = ["-m", "pip", "install"];

            if (pack.url) {
                args.push("--target", this.userLibPath, pack.url, "--upgrade");
            } else {
                let packageName = pack.name;
                if (pack.version) {
                    packageName += "==" + pack.version;
                }
                args.push(
                    "--target", this.userLibPath,
                    packageName,
                    "--no-cache-dir",
                    "--no-warn-script-location",
                    "--upgrade",
                    "--index-url", this.mirrors[this.mirrorIndex].mirror
                );
            }

            this.currentProcess = spawn({
                cmd: [this.pythonPath, ...args],
                stdout: "pipe",
                stderr: "pipe",
            });

            const decoder = new TextDecoder();
            const reader = this.currentProcess.stdout.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                this.notifyProgress({
                    name: pack.name,
                    progress: 50,
                    state: "installing",
                    msg: text.substring(0, 100),
                });
            }

            const exitCode = await this.currentProcess.exited;

            if (exitCode === 0) {
                this.notifyProgress({
                    name: pack.name,
                    progress: 100,
                    state: "installed",
                    msg: "安装成功",
                });
            } else {
                const stderr = await new Response(this.currentProcess.stderr).text();
                this.notifyProgress({
                    name: pack.name,
                    progress: 0,
                    state: "error",
                    msg: stderr.substring(0, 200),
                });
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.notifyProgress({
                name: pack.name,
                progress: 0,
                state: "error",
                msg: errMsg,
            });
        } finally {
            this.currentProcess = null;
            this.currentInstalling = null;
            this.processNext();
        }
    }

    private processNext(): void {
        if (this.processQueue.length > 0) {
            const nextName = this.processQueue.shift();
            if (nextName) {
                this.handleInstall({ name: nextName });
            }
        }
    }

    async handleUninstall(packageName: string): Promise<boolean> {
        try {
            const args = [
                this.pythonPath, "-m", "pip", "uninstall",
                "-y", packageName
            ];

            const proc = spawn({
                cmd: args,
                stdout: "pipe",
                stderr: "pipe",
            });

            await proc.exited;

            await this.deleteLibDir(packageName);
            await this.deleteLibInfo(packageName);

            return true;
        } catch (error) {
            console.error("卸载时错误:", error);
            return false;
        }
    }

    private async deleteLibDir(packageName: string): Promise<void> {
        const libPath = join(this.userLibPath, packageName);
        if (existsSync(libPath)) {
            await rm(libPath, { recursive: true, force: true });
        }
    }

    private async deleteLibInfo(packageName: string): Promise<void> {
        try {
            const files = await readdir(this.userLibPath);
            const pattern = new RegExp(`^${packageName.replace("-", "_")}(.*)\\.dist-info$`);

            for (const file of files) {
                if (pattern.test(file)) {
                    await rm(join(this.userLibPath, file), { recursive: true, force: true });
                }
            }
        } catch {
            // 忽略
        }
    }

    async handleSearch(name: string): Promise<any[]> {
        try {
            const response = await fetch(`https://pypi.org/search/?q=${encodeURIComponent(name)}`);
            const html = await response.text();
            
            const results: any[] = [];
            
            const nameVersionRegex = /<span\s+class="package-snippet__name">([^<]+)<\/span>[\s\S]*?<span\s+class="package-snippet__version">([^<]+)<\/span>/g;
            let match;
            while ((match = nameVersionRegex.exec(html)) !== null) {
                results.push({
                    name: match[1].trim(),
                    version: match[2].trim(),
                    desc: ""
                });
            }
            
            const descRegex = /<span\s+class="package-snippet__name">([^<]+)<\/span>[\s\S]*?<p\s+class="package-snippet__description">([^<]*)/g;
            const descMap: Record<string, string> = {};
            while ((match = descRegex.exec(html)) !== null) {
                descMap[match[1].trim()] = match[2].trim();
            }
            
            for (const r of results) {
                if (descMap[r.name]) {
                    r.desc = descMap[r.name];
                }
            }
            
            return results;
        } catch (e) {
            console.error("Search error:", e);
            return [];
        }
    }

    cancelInstall(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
            this.currentInstalling = null;
        }
        this.processQueue = [];
    }

    getProcess(): ProcessInfo | null {
        if (!this.currentInstalling) return null;

        return {
            name: this.currentInstalling,
            progress: 50,
            state: "installing",
            msg: "安装中",
        };
    }
}

export const pkgManager = new PackageManager();
