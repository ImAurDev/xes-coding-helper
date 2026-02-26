export enum PackageState {
    installing = "installing",
    installed = "installed",
    waiting = "waiting",
    not_installed = "not_installed",
    err = "err",
    builtin = "builtin",
}

export interface PackageData {
    name: string;
    desc: string;
    url?: string;
    version?: string;
    detail?: string;
    pip_source?: string;
}

export class Package {
    name: string;
    desc: string;
    state: string;
    url?: string;
    version?: string;
    detail?: string;
    pip_source?: string;

    constructor(
        name: string,
        desc: string,
        state: PackageState = PackageState.not_installed,
        url?: string,
        version?: string,
        detail?: string,
        pip_source?: string
    ) {
        this.name = name;
        this.desc = desc;
        this.state = state.valueOf();
        this.url = url;
        this.version = version;
        this.detail = detail;
        this.pip_source = pip_source;
    }

    changeState(newState: PackageState): void {
        this.state = newState.valueOf();
    }

    static fromDict(data_dict: PackageData & { state?: PackageState }): Package {
        return new Package(
            data_dict.name,
            data_dict.desc,
            data_dict.state || PackageState.not_installed,
            data_dict.url,
            data_dict.version,
            data_dict.detail,
            data_dict.pip_source
        );
    }

    toJSON(): PackageData & { state: string } {
        return {
            name: this.name,
            desc: this.desc,
            state: this.state,
            url: this.url,
            version: this.version,
            detail: this.detail,
            pip_source: this.pip_source,
        };
    }
}
