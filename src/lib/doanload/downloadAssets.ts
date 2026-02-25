import { mkdir, readdir, readFile, writeFile, rm, stat, copyFile, rename } from "fs/promises";
import { createHash } from "crypto";
import { join, dirname, basename } from "path";
import { existsSync, createReadStream, mkdirSync } from "fs";

let _curPath: string = "";
let _curPid: string = "";
let _fileServer = null;
const _fileMap: Map<string, { dict: string }> = new Map();
const CACHE_PATH = process.env.THONNY_CACHE || `${process.env.HOME}/.thonny/cache`;
const BASE_PORT = parseInt(process.env.THONNY_PORT || "8000");
const FILE_SERVER_PORT = BASE_PORT + 4;
const ASSET_PATH = join(CACHE_PATH, "asset");
const ASSET_POOL_PATH = join(CACHE_PATH, "asset_pool");

const CDNS = [
    "http://static0.xesimg.com",
    "https://static0.xesimg.com",
    "http://static1.xesimg.com",
    "https://static1.xesimg.com",
    "http://static2.xesimg.com",
    "https://static2.xesimg.com",
    "http://static3.xesimg.com",
    "https://static3.xesimg.com",
    "http://static4.xesimg.com",
    "https://static4.xesimg.com",
    "http://static5.xesimg.com",
    "https://static5.xesimg.com",
    "http://static6.xesimg.com",
    "https://static6.xesimg.com",
    "http://static7.xesimg.com",
    "https://static7.xesimg.com",
    "http://static8.xesimg.com",
    "https://static8.xesimg.com",
    "http://static9.xesimg.com",
    "https://static9.xesimg.com",
    "http://static10.xesimg.com",
    "https://static10.xesimg.com",
    "https://livefile.xesimg.com",
    "https://livefile.xesv5.com",
    "https://livefile.xescdn.com",
    "http://livefile.xesimg.com",
    "http://livefile.xesv5.com",
    "http://livefile.xescdn.com",
];
let cdnIndex = 0;

interface AssetInfo {
    id: string;
    name: string;
    type: "dir" | "oss_file" | "local_file";
    md5ext?: string;
    assetId?: string;
    value?: string;
    children?: AssetInfo[];
    disabled?: boolean;
    path?: string;
}

interface AssetJson {
    projectId: string;
    assets: AssetInfo[];
    preload?: string;
    xml?: string;
    [key: string]: unknown;
}

interface ComparedResult {
    new: FileInfo[];
    del: FileInfo[];
    mod: FileInfo[];
    dir_del: { cid: string }[];
    dir_new: DirInfo[];
}

interface FileInfo {
    path: string;
    md5: string;
    uri: string;
    fid?: string;
    cid?: string;
}

interface DirInfo {
    fid: string;
    uri: string;
}

interface Response<T = unknown> {
    OK: boolean;
    data?: T;
    error?: string;
}

function pushLog(type: string, level: number, msg: string): void {
    console.log(`[${type}] ${msg}`);
}

function xesLogger(data: Record<string, string>): void {
    console.log("[XES]", JSON.stringify(data));
}

function getStrMd5(str: string): string {
    return createHash("md5").update(str, "utf8").digest("hex");
}

async function getFileMd5(filePath: string): Promise<string> {
    const stream = createReadStream(filePath);
    const hash = createHash("md5");

    for await (const chunk of stream) {
        hash.update(chunk);
    }

    return hash.digest("hex");
}

async function getMd5New(filePath: string): Promise<string> {
    const content = await readFile(filePath, "utf-8");
    const normalized = content.replace(/\r\n/g, "\n");
    return createHash("md5").update(normalized, "utf8").digest("hex");
}

export class AssetManage {
    private assetPath: string = "";
    private assetPoolPath: string;
    private assetPoolFiles: string[] = [];
    private preloadPath: string = "";
    private preloadFiles: string[] = [];
    private jsonInfo: AssetJson | null = null;

    private assets: AssetInfo[] = [];
    private compared: ComparedResult = {
        new: [],
        del: [],
        mod: [],
        dir_del: [],
        dir_new: [],
    };
    private assetMap: Map<string, FileInfo> = new Map();
    private dictMap: Map<string, FileInfo> = new Map();
    private dictIds: Map<string, string> = new Map();
    private localMap: Set<string> = new Set();
    private localDirIds: Map<string, string> = new Map();
    private newDirInfos: DirInfo[] = [];

    private static fileMap: Map<string, { dict: string; file: string }> = new Map();

    constructor() {
        this.assetPoolPath = ASSET_POOL_PATH;
    }

    async init(): Promise<void> {
        if (!existsSync(this.assetPoolPath)) {
            await mkdir(this.assetPoolPath, { recursive: true });
        }
        this.assetPoolFiles = await this.getFiles(this.assetPoolPath);
    }

    async handleAssetsJson(jsonInfo: AssetJson): Promise<Response> {
        await this.init();
        this.jsonInfo = jsonInfo;

        this.assetPath = join(ASSET_PATH, String(jsonInfo.projectId));

        const fileName = "asset_info.json";
        const assetInfoPath = join(this.assetPath, fileName);

        if (!existsSync(this.assetPath)) {
            const result = await this.downloadAssetByJson(jsonInfo);
            if (result !== true) {
                return { OK: false, error: String(result) };
            }

            const writeRes = await this.createFile(assetInfoPath, JSON.stringify(jsonInfo));
            if (writeRes !== true) {
                return { OK: false, error: String(writeRes) };
            }

            return { OK: true };
        }

        const localJson = await this.getLocalJson(assetInfoPath);
        if (localJson instanceof Error) {
            await this.delFiles(this.assetPath);
            const result = await this.downloadAssetByJson(jsonInfo);
            if (result !== true) return { OK: false, error: String(result) };

            await this.createFile(assetInfoPath, JSON.stringify(jsonInfo));
            return { OK: true };
        }

        const localMd5 = getStrMd5(JSON.stringify(localJson));
        const newMd5 = getStrMd5(JSON.stringify(jsonInfo));

        if (localMd5 !== newMd5) {
            const delRes = await this.delFiles(this.assetPath);
            if (delRes !== true) return { OK: false, error: String(delRes) };

            const downloadRes = await this.downloadAssetByJson(jsonInfo);
            if (downloadRes !== true) return { OK: false, error: String(downloadRes) };

            const writeRes = await this.createFile(assetInfoPath, JSON.stringify(jsonInfo));
            if (writeRes !== true) return { OK: false, error: String(writeRes) };
        }

        return { OK: true };
    }

    async getLocalJson(fileName: string): Promise<AssetJson | Error> {
        try {
            const content = await readFile(fileName, "utf-8");
            return JSON.parse(content);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            xesLogger({
                clicknane: "read_local_json_err",
                errmsg: `读取本地json文件 ${fileName} 错误 ${err.message}`,
            });
            pushLog("LOG", 0, `read local json file err: ${err.message}`);
            return err;
        }
    }

    async getFiles(dir: string): Promise<string[]> {
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            return entries.filter((e) => e.isFile()).map((e) => e.name);
        } catch (e) {
            pushLog("LOG", 0, `get local file list err: ${e}`);
            return [];
        }
    }

    async downloadAssetByUrl(url: string): Promise<Response | null> {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        };

        try {
            const res = await fetch(url, { headers });
            if (res.status === 200 || res.status === 304) {
                return { OK: true, data: await res.arrayBuffer() };
            }

            xesLogger({
                clicknane: "download_assets",
                errmsg: `download_asset ${url} 失败 ${res.status}`,
            });
            return null;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            xesLogger({
                clicknane: "download_assets",
                errmsg: `download_asset ${url} 错误 ${errMsg}`,
            });
            pushLog("LOG", 0, `by url download asset error: ${errMsg}`);
            return null;
        }
    }

    async downloadAssetByJson(jsonInfo: AssetJson): Promise<true | Error | string> {
        if (!existsSync(this.assetPath)) {
            await mkdir(this.assetPath, { recursive: true });
        }

        this.assets = [];
        await this.buildDict(this.assetPath, jsonInfo.assets, "");

        for (const asset of this.assets) {
            const md5ext = asset.md5ext!;

            if (this.assetPoolFiles.includes(md5ext)) {
                const res = await this.copyAndRename(
                    this.assetPoolPath,
                    md5ext,
                    asset.path!,
                    asset.name,
                );
                if (res !== true) return res;
                continue;
            }

            if (this.preloadFiles.includes(md5ext)) {
                const res = await this.copyAndRename(
                    this.preloadPath,
                    md5ext,
                    asset.path!,
                    asset.name,
                );
                if (res !== true) return res;
                continue;
            }

            const startIdx = cdnIndex;
            let cdn = this.getCdn(-1);

            while (cdn) {
                const url = `${cdn}/programme/python_assets/${md5ext}`;
                const data = await this.downloadAssetByUrl(url);

                if (data?.OK && data.data) {
                    const poolRes = await this.createFile(
                        join(this.assetPoolPath, md5ext),
                        data.data,
                    );
                    if (poolRes !== true) return poolRes;

                    const copyRes = await this.copyAndRename(
                        this.assetPoolPath,
                        md5ext,
                        asset.path!,
                        asset.name,
                    );
                    if (copyRes !== true) return copyRes;

                    break;
                }

                cdnIndex++;
                cdn = this.getCdn(startIdx);
            }

            if (!cdn) {
                return "资源下载失败，请重试";
            }
        }

        return true;
    }

    private getCdn(startIdx: number): string | false {
        if (cdnIndex - startIdx >= CDNS.length) return false;
        return CDNS[cdnIndex % CDNS.length];
    }

    async copyAndRename(
        srcDir: string,
        srcName: string,
        dstDir: string,
        dstName: string,
    ): Promise<true | Error> {
        const srcPath = join(srcDir, srcName);
        const dstPath = join(dstDir, srcName);

        const copyRes = await this.copyFile(srcPath, dstDir);
        if (copyRes !== true) return copyRes;

        try {
            await rename(dstPath, join(dstDir, dstName));
            return true;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            xesLogger({ clicknane: "rename_file_err", errmsg: `重命名文件错误: ${err.message}` });
            pushLog("LOG", 0, `rename file err: ${err.message}`);
            return err;
        }
    }

    async copyFile(srcFile: string, dstDir: string): Promise<true | Error> {
        try {
            const dstPath = join(dstDir, basename(srcFile));
            await copyFile(srcFile, dstPath);
            return true;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            xesLogger({ clicknane: "copy_file_err", errmsg: `复制文件错误: ${err.message}` });
            this.handleErr(err);
            pushLog("LOG", 0, `copy file err ${err.message}`);
            return err;
        }
    }

    async createFile(fileName: string, content: string | ArrayBuffer): Promise<true | Error> {
        try {
            await mkdir(dirname(fileName), { recursive: true });

            if (content instanceof ArrayBuffer) {
                await writeFile(fileName, new Uint8Array(content));
            } else {
                await writeFile(fileName, content, "utf-8");
            }
            return true;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            xesLogger({
                clicknane: "create_file_err",
                errmsg: `create file ${fileName} 错误 ${err.message}`,
            });
            this.handleErr(err);
            pushLog("LOG", 0, `create file err: ${err.message}`);
            return err;
        }
    }

    async delFiles(path: string, delSelf: boolean = false): Promise<true | Error> {
        try {
            if (!existsSync(path)) return true;

            const entries = await readdir(path, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = join(path, entry.name);
                if (entry.isDirectory()) {
                    await this.delFiles(fullPath, true);
                } else {
                    await rm(fullPath);
                }
            }

            if (delSelf) {
                await rm(path, { recursive: true });
            }
            return true;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            xesLogger({
                clicknane: "delete_file_err",
                errmsg: `delete file ${path} 错误 ${err.message}`,
            });
            pushLog("LOG", 0, `delete file err: ${err.message}`);
            return err;
        }
    }

    private async buildDict(path: string, children: AssetInfo[], relaPath: string): Promise<void> {
        for (const child of children) {
            if (child.disabled) continue;

            const curPath = join(path, child.name);
            const nextRelaPath = join(relaPath, child.name);

            if (child.type === "dir") {
                if (!existsSync(curPath)) {
                    mkdirSync(curPath, { recursive: true });
                }
                if (child.children?.length) {
                    await this.buildDict(curPath, child.children, nextRelaPath);
                }
            } else if (child.type === "oss_file") {
                child.path = path;
                AssetManage.fileMap.set(child.id, { dict: nextRelaPath, file: child.name });
                this.assets.push(child);
            } else if (child.type === "local_file") {
                await this.createFile(curPath, child.value || "");
            }
        }
    }

    buildAssetsMap(path: string, children: AssetInfo[], relaPath: string, fid: string): void {
        for (const child of children) {
            if (child.disabled) continue;

            const curPath = join(path, child.name);
            const nextRelaPath = join(relaPath, child.name);

            if (child.type === "dir") {
                this.dictIds.set(nextRelaPath, child.id);
                if (child.children?.length) {
                    this.buildAssetsMap(curPath, child.children, nextRelaPath, child.id);
                }
            } else {
                const fileKey = join(relaPath, child.name);
                const port = this.getPort() + 4;

                const info: FileInfo = {
                    path: `http://127.0.0.1:${port}/${fileKey}`,
                    md5: child.assetId || getStrMd5(child.value || ""),
                    uri: child.name,
                    fid,
                    cid: child.id,
                };

                if (child.type === "local_file") {
                    this.localMap.add(fileKey);
                }

                this.assetMap.set(fileKey, info);
            }
        }
    }

    async buildDictMap(path: string): Promise<number> {
        let size = 0;
        return size;
    }

    async compareAssets(): Promise<ComparedResult | 1 | 2> {
        this.assetMap.clear();
        this.dictMap.clear();
        this.compared = { new: [], del: [], mod: [], dir_del: [], dir_new: [] };

        this.buildAssetsMap(this.assetPath, this.jsonInfo!.assets, "", "root");
        const size = await this.buildDictMap(this.assetPath);

        if (size / 1024 / 1024 > 20) return 1;

        return this.compared;
    }

    private getPort(): number {
        return parseInt(process.env.THONNY_PORT || "8000");
    }

    private handleErr(err: Error): void {
        const NO_SPACE_MSG = "No space left on device";
        if (err.message.includes(NO_SPACE_MSG)) {
            pushLog("LOG", 0, "磁盘空间不足！");
        }
    }
}

async function killPort(port: number): Promise<void> {
    const platform = process.platform;

    try {
        if (platform === "win32") {
            const proc = Bun.spawn(
                [
                    "cmd",
                    "/c",
                    `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`,
                ],
                { stdout: "null", stderr: "null" },
            );
            await proc.exited;
        } else {
            const findProc = Bun.spawn(["lsof", "-ti", `:${port}`], {
                stdout: "pipe",
                stderr: "null",
            });
            const pid = await new Response(findProc.stdout).text();
            if (pid.trim()) {
                Bun.spawn(["kill", "-9", pid.trim()], { stdout: "null", stderr: "null" });
            }
        }

        await new Promise((r) => setTimeout(r, 500));
    } catch (e) {}
}

async function startFileServer(pid: string, assetPath: string): Promise<boolean> {
    if (_fileServer) {
        _fileServer.stop();
        _fileServer = null;
    }

    if (!existsSync(assetPath)) {
        console.error(`Asset path does not exist: ${assetPath}`);
        return false;
    }

    const available = await isPortAvailable(FILE_SERVER_PORT);
    if (!available) {
        await killPort(FILE_SERVER_PORT);
        const retry = await isPortAvailable(FILE_SERVER_PORT);
        if (!retry) {
            console.error(`Port ${FILE_SERVER_PORT} is still in use`);
            return false;
        }
    }

    try {
        _fileServer = serve({
            port: FILE_SERVER_PORT,
            fetch(req) {
                const url = new URL(req.url);
                const filePath = join(assetPath, url.pathname);

                if (!filePath.startsWith(assetPath)) {
                    return new Response("Forbidden", { status: 403 });
                }

                const file = Bun.file(filePath);
                return new Response(file);
            },
        });

        console.log(`文件服务器开启于 http://127.0.0.1:${FILE_SERVER_PORT}`);

        _curPid = pid;
        _curPath = assetPath;

        return true;
    } catch (e) {
        console.error("无法开启文件服务器:", e);
        return false;
    }
}

export async function getLocalPath(pid: string | number, fid: string): Promise<string | false> {
    pid = String(pid);
    let needStart = false;

    const fileInfo = _fileMap.get(fid);
    if (!fileInfo) {
        return false;
    }

    const targetPath = fileInfo.dict;

    if (_fileServer === null) {
        needStart = true;
    } else if (_curPid !== pid) {
        _fileServer.stop();
        _fileServer = null;
        needStart = true;
    }

    if (needStart) {
        const assetPath = join(CACHE_PATH, "asset", pid);

        const success = await startFileServer(pid, assetPath);
        if (!success) {
            return false;
        }

        await new Promise((r) => setTimeout(r, 100));

        try {
            const check = await fetch(`http://127.0.0.1:${FILE_SERVER_PORT}/`, {
                method: "HEAD",
            });
            if (!check.ok && check.status !== 404) {
                return false;
            }
        } catch (e) {
            return false;
        }

        return targetPath.replace(/\\/g, "/");
    }

    return targetPath.replace(/\\/g, "/");
}

export function registerFile(fid: string, dict: string): void {
    _fileMap.set(fid, { dict });
}

export function clearFileMap(): void {
    _fileMap.clear();
}

export function stopFileServer(): void {
    if (_fileServer) {
        _fileServer.stop();
        _fileServer = null;
        _curPid = "";
        _curPath = "";
    }
}
