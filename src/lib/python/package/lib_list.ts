import { Package, PackageState, type PackageData } from "./package";
import { pkgManager } from "./package_manager";
import { Webtty } from "../../websocket/websocket";

const MUST_TYPE = "must";
const OPTION_TYPE = "option";
const CACHE_TYPE = "cache";

interface PackageDict {
    [key: string]: { pack_type: string; index: number };
}

interface InstallTag {
    [key: string]: any;
}

interface PreState {
    [key: string]: PackageState;
}

export class PackageList {
    private state: PackageState = PackageState.installed;
    private queue: string[] = [];
    private tmpQueue: string[] = [];
    private currentInstalling: string | null = null;
    private packages: { [key: string]: Package[] } = {
        [MUST_TYPE]: [
            new Package(
                "xes-lib",
                "xes-lib是学而思专用的python库，实现了很多实用的功能，包括发送、路径查询、预处理、文件操作等功能...",
                PackageState.not_installed
            ),
            new Package(
                "qrcode",
                "二维码编码解码库。",
                PackageState.not_installed
            ),
        ],
        [OPTION_TYPE]: [
            new Package(
                "Pillow",
                "一个图像处理库，可以对图像进行旋转、缩放、裁剪、增色等处理。",
                PackageState.not_installed
            ),
            new Package(
                "numpy",
                "Python最常用的科学计算库，为Python提供了很多高级数学函数。",
                PackageState.not_installed
            ),
            new Package(
                "algorithms",
                "一个 Python 算法库，提供了常用的数据结构和算法。",
                PackageState.not_installed
            ),
        ],
        [CACHE_TYPE]: [],
    };
    private errDict: PackageDict = {};
    private nameDict: PackageDict = {};
    private staticList: { [key: string]: number } = {};
    private userList: Package[] = [];
    private descList: { [key: string]: string } = {};
    private installedErrQue: string[] = [];
    private hasNewErr: number = 0;
    private installTags: InstallTag = {};
    private preStates: PreState = {};
    private lockId: string | null = null;
    private lastReqTime: number | null = null;
    private webtty: Webtty | null = null;

    constructor() {
        for (const [key, list] of Object.entries(this.packages)) {
            list.forEach((item, index) => {
                this.nameDict[item.name] = { pack_type: key, index };
            });
        }

        this.startAutoDestroyState();
    }

    setWebtty(webtty: Webtty): void {
        this.webtty = webtty;
    }

    private startAutoDestroyState(): void {
        setInterval(() => {
            this.getState("");
        }, 1000);
    }

    async loadLocal(): Promise<void> {
        const localPkg = await pkgManager.getLocalList(true);
        this.userList = localPkg.user.map(
            (p: any) =>
                new Package(
                    p.name,
                    p.version || "",
                    PackageState.installed
                )
        );

        const userNameDict: { [key: string]: number } = {};
        for (const pack of this.userList) {
            userNameDict[pack.name] = 1;
            if (pack.name in this.errDict) {
                this.removeErrPack(pack.name);
            }
            if (pack.name in this.nameDict) {
                const optType = this.nameDict[pack.name].pack_type;
                if (optType === MUST_TYPE) {
                    const servPack = this.getPackageByName(pack.name);
                    if (
                        servPack.version &&
                        servPack.version !== "" &&
                        pack.version !== servPack.version
                    ) {
                        this.uninstallHandler(pack.name);
                    }
                    this.changeStateByName(pack.name, PackageState.installed);
                }
            }
        }

        for (const pack of localPkg.lib) {
            this.staticList[pack.name] = 1;
        }
    }

    async checkMust(): Promise<void> {
        for (const mustPack of this.packages[MUST_TYPE]) {
            if (mustPack.state === PackageState.not_installed) {
                console.log(`需要安装前置 ${mustPack.name}`);
                try {
                    await this.installHandler(mustPack.name, mustPack.version, mustPack.desc, null);
                } catch (e) {
                    console.error(`前置安装错误: ${e}`);
                }
            }
        }
    }

    updatePackData(jsonRes: any): void {
        try {
            const tmpNameDict: PackageDict = {};
            const tmpPackages: { [key: string]: Package[] } = {
                [MUST_TYPE]: [],
                [OPTION_TYPE]: [],
            };

            for (const [key, list] of Object.entries(jsonRes.data.libs)) {
                for (const dic of list as any[]) {
                    const pack = Package.fromDict(dic);
                    tmpNameDict[pack.name] = { pack_type: key, index: tmpPackages[key].length };
                    tmpPackages[key].push(pack);
                }
            }

            this.nameDict = tmpNameDict;
            this.packages[MUST_TYPE] = tmpPackages[MUST_TYPE];
            this.packages[OPTION_TYPE] = tmpPackages[OPTION_TYPE];

            this.packages[CACHE_TYPE].forEach((pack, index) => {
                this.nameDict[pack.name] = { pack_type: CACHE_TYPE, index };
            });
        } catch (e) {
            console.error("更新包时出现错误:", e);
        }
    }

    changeStateByName(name: string, state: PackageState): void {
        if (state === PackageState.installing) {
            this.currentInstalling = name;
        }
        const packType = this.nameDict[name].pack_type;
        const index = this.nameDict[name].index;
        this.packages[packType][index].changeState(state);
    }

    getPackageByName(name: string): Package {
        const packType = this.nameDict[name].pack_type;
        const index = this.nameDict[name].index;
        return this.packages[packType][index];
    }

    async getPackList(pageId: string): Promise<any> {
        if (!this.checkLock(pageId)) {
            return false;
        }

        const res: any = {};
        res.state = this.state.valueOf();

        const localPkg = await pkgManager.getLocalList(true);
        const optionList = localPkg.user;
        const localList = localPkg.lib;

        const needFilterKeys: { [key: string]: number } = {};
        for (const pack of localList) {
            needFilterKeys[pack.name] = 1;
        }

        const filteredList = optionList.filter(
            (pack: any) => !needFilterKeys[pack.name]
        );

        const lastOptionList: Package[] = [];
        const needShow: string[] = [];

        for (const pack of filteredList) {
            if (pack.name in this.errDict) {
                this.removeErrPack(pack.name);
            }
            if (pack.name in this.nameDict) {
                const optType = this.nameDict[pack.name].pack_type;
                if (optType === MUST_TYPE || optType === OPTION_TYPE) {
                    this.changeStateByName(pack.name, PackageState.installed);
                } else {
                    if (pack.name in this.descList) {
                        pack.desc = this.descList[pack.name];
                    } else {
                        needShow.push(pack.name);
                    }
                    lastOptionList.push(Package.fromDict(pack));
                }
            } else {
                if (pack.name in this.descList) {
                    pack.desc = this.descList[pack.name];
                } else {
                    needShow.push(pack.name);
                }
                lastOptionList.push(Package.fromDict(pack));
                this.nameDict[pack.name] = {
                    pack_type: CACHE_TYPE,
                    index: this.packages[CACHE_TYPE].length,
                };
                this.packages[CACHE_TYPE].push(Package.fromDict(pack));
            }
        }

        res[MUST_TYPE] = [...this.packages[MUST_TYPE]];
        res[OPTION_TYPE] = [...this.packages[OPTION_TYPE], ...lastOptionList];
        res.state = this.state.valueOf();

        if (needShow.length > 0) {
            this.checkPackDesc(needShow);
        }

        return this.filterRetLibs(res);
    }

    getErrList(): any[] {
        const res: any[] = [];
        for (const name in this.errDict) {
            const cache = this.nameDict[name];
            res.push(this.packages[cache.pack_type][cache.index]);
        }
        return res;
    }

    private filterRetLibs(originLibs: any): any {
        const targetLibs = { ...originLibs };
        const newMustArr = targetLibs[MUST_TYPE].filter(
            (lib: Package) => lib.name !== "xesrepair"
        );
        targetLibs[MUST_TYPE] = newMustArr;
        return targetLibs;
    }

    private async checkPackDesc(showList: string[]): Promise<void> {
        for (const name of showList) {
            if (!(name in this.descList)) {
                const info = await pkgManager.getModuleInfo(name);
                if (info.Summary) {
                    this.descList[name] = info.Summary;
                }
            }
        }
    }

    private checkLock(pageId: string): boolean {
        if (this.state === PackageState.installing) {
            if (this.lockId === null) {
                this.lockId = pageId;
                return true;
            }
            if (this.lockId === pageId) {
                return true;
            }
            if (pageId === null) {
                return true;
            }
            return false;
        } else {
            this.lockId = null;
            return true;
        }
    }

    unlock(pageId: string): void {
        if (this.lockId === pageId) {
            this.lockId = null;
        }
    }

    async getAllState(pageId: string): Promise<any> {
        if (!this.checkLock(pageId)) {
            return false;
        }

        const res: any = {};
        res.all_state = this.state.valueOf();
        res.err_count = Object.keys(this.errDict).length;
        let curCnt = 0;
        if (this.currentInstalling !== null) {
            curCnt = 1;
        }
        res.installing_count = curCnt + this.queue.length;
        return res;
    }

    getState(pre: string, isReq: boolean = false): any {
        if (isReq) {
            this.lastReqTime = Date.now();
        } else {
            const res = pkgManager.getProcess();
            if (res === null) {
                return {
                    all_state: this.state.valueOf(),
                    err_count: Object.keys(this.errDict).length,
                    installing_count: this.currentInstalling ? 1 + this.queue.length : this.queue.length,
                    desc: "",
                    has_new_err: false,
                    tag: null,
                };
            }

            if (res.state === "installed") {
                if (res.name in this.errDict) {
                    delete this.errDict[res.name];
                }
                this.changeStateByName(res.name, PackageState.installed);
                this.checkNext();
            } else if (res.state === "error") {
                this.hasNewErr = 1;
                this.errDict[res.name] = this.nameDict[res.name];
                this.changeStateByName(res.name, PackageState.err);
                this.checkNext();
            }

            return {
                ...res,
                all_state: this.state.valueOf(),
                err_count: Object.keys(this.errDict).length,
                installing_count: this.currentInstalling ? 1 + this.queue.length : this.queue.length,
            };
        }
    }

    private checkNext(): void {
        if (this.queue.length > 0) {
            const nextP = this.queue.shift()!;
            this.currentInstalling = nextP;
            this.changeStateByName(nextP, PackageState.installing);
            const pack = this.getPackageByName(nextP);
            pkgManager.handleInstall(pack);
        } else {
            this.currentInstalling = null;
            if (Object.keys(this.errDict).length > 0) {
                if (this.hasNewErr === 1) {
                    this.hasNewErr = 2;
                } else {
                    this.hasNewErr = 0;
                }
                this.state = PackageState.err;
            } else {
                this.state = PackageState.installed;
            }
        }
    }

    async installHandler(
        name: string,
        version: string = "",
        desc: string = "",
        pageId: string | null = null
    ): Promise<string> {
        this.installTags[name] = null;
        if (name !== "xesrepair") {
            this.state = PackageState.installing;
        } else {
            const canUse = this.checkLock(pageId || "");
            return canUse ? "true" : "false";
        }

        if (!(name in this.nameDict)) {
            this.preStates[name] = PackageState.not_installed;
            const cachePack = new Package(name, desc);
            this.packages[CACHE_TYPE].push(cachePack);
            this.nameDict[name] = {
                pack_type: CACHE_TYPE,
                index: this.packages[CACHE_TYPE].length - 1,
            };
        } else {
            const packType = this.nameDict[name].pack_type;
            const index = this.nameDict[name].index;
            const cachePack = this.packages[packType][index];
            this.preStates[name] = PackageState.not_installed;
            if (cachePack.state === PackageState.err) {
                this.preStates[name] = PackageState.err;
            }
        }

        if (this.queue.length > 0 || this.currentInstalling !== null) {
            this.queue.push(name);
            this.changeStateByName(name, PackageState.waiting);
            return PackageState.waiting.valueOf();
        }

        this.changeStateByName(name, PackageState.installing);
        const pack = this.getPackageByName(name);
        await pkgManager.handleInstall(pack);
        return PackageState.installing.valueOf();
    }

    async cancelInstallHandler(name: string): Promise<void> {
        const preState = this.preStates[name];
        this.changeStateByName(name, preState);

        if (name === this.currentInstalling) {
            pkgManager.cancelInstall();
            this.checkNext();
        } else {
            const idx = this.queue.indexOf(name);
            if (idx > -1) {
                this.queue.splice(idx, 1);
            }
        }
    }

    async uninstallHandler(name: string): Promise<void> {
        if (name in this.nameDict) {
            await pkgManager.handleUninstall(name);
            this.changeStateByName(name, PackageState.not_installed);
        }
    }

    private removeErrPack(name: string): void {
        if (name in this.errDict) {
            const cache = this.nameDict[name];
            this.packages[cache.pack_type][cache.index].state = PackageState.not_installed;
            delete this.errDict[name];
            if (this.queue.length === 0 && Object.keys(this.errDict).length === 0) {
                this.state = PackageState.installed;
            }
        }
    }

    async searchHandler(name: string, flag: boolean): Promise<any> {
        let resList: Package[] = [];

        if (flag && name in this.nameDict) {
            resList = [this.getPackageByName(name)];
        } else {
            const searchResult = await pkgManager.handleSearch(name);
            resList = searchResult.map((p: any) =>
                Package.fromDict({ name: p.name, desc: "", ...p })
            );
        }

        const res: any = { [MUST_TYPE]: [], [OPTION_TYPE]: [] };

        for (const pack of resList) {
            if (pack.name in this.staticList) {
                pack.state = PackageState.builtin;
                res[OPTION_TYPE].push(pack);
            } else if (pack.name in this.nameDict) {
                const cachePack = this.getPackageByName(pack.name);
                if (this.nameDict[pack.name].pack_type === MUST_TYPE) {
                    res[MUST_TYPE].push(cachePack);
                } else {
                    res[OPTION_TYPE].push(cachePack);
                }
            } else {
                res[OPTION_TYPE].push(pack);
            }
            if (flag) {
                this.packages[CACHE_TYPE].push(pack);
                this.nameDict[pack.name] = {
                    pack_type: CACHE_TYPE,
                    index: this.packages[CACHE_TYPE].length - 1,
                };
            }
        }

        return res;
    }
}

export const packList = new PackageList();

export async function loadOriginPack(): Promise<void> {
    try {
        const res = await fetch("http://code.xueersi.com/api/python/libs");
        if (res.ok) {
            const resObj = await res.json();
            packList.updatePackData(resObj);
            await packList.loadLocal();
            await packList.checkMust();
        } else {
            await packList.loadLocal();
        }
    } catch (e) {
        console.error("加载原始包出错：", e);
        await packList.loadLocal();
    }
}
