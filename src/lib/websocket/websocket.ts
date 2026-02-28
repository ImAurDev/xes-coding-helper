import { serve, type Server } from "bun";
import { AssetManage } from "../download/downloadAssets";

const OUTPUT = "1";
const INPUT = "1";
const USER_MSG = "7";

export enum State {
    WAIT = 1,
    READY = 2,
}

enum AssetState {
    Checking = 0,
    Ready = 1,
    Error = 2,
}

export interface WebSocketData {
    clientId: number;
    src: string;
    server?: Server<WebSocketData>;
}

interface ClientData {
    clientId: number;
    src: string;
    server?: Server<WebSocketData>;
}

interface MessageData {
    type?: string;
    handle?: string;
    projectId?: string;
    xml?: string;
    cookies?: string;
    assets?: unknown[];
    [key: string]: unknown;
}

interface FormMsg {
    Type: string;
    Info: string;
}

interface Cmd {
    type?: string;
    data?: string;
    inner_err?: string;
    err?: unknown;
    command_name?: string;
    OutRaw?: string;
}

const idDict = new Map<string, number>();
let clientIdCounter = 0;

export class Webtty {
    constructor() {
        setWebtty(this);
    }

    private _client: any = null;
    private _state: State = State.WAIT;
    private _path: string | null = null;
    private _code: string | null = null;
    private _enable = true;
    private _inputs: string[] = [];
    private _tmpInputs: string[] = [];
    private _firstMsg: string | null = null;
    private loadFlag = true;
    private hasRun = false;
    private routeMaps = new Map<string, (webtty: Webtty) => void | Promise<void>>();
    private _linkClient: any = null;
    private closed = true;
    private _linkMessages: string[] = [];
    private _lock = false;
    private _nextLinkClient: any = null;
    private _am: AssetManage | null = null;
    private _waitToClose = false;
    private _server: Server<WebSocketData> | null = null;

    setServer(server: Server<WebSocketData>) {
        this._server = server;
    }

    addUrlRule(url: string, _endpoint: string, f: (webtty: Webtty) => void | Promise<void>) {
        this.routeMaps.set(url, f);
    }

    newClient(ws: any): void {
        const src = ws.data.src;

        if (src !== "/") {
            if (!this.routeMaps.has(src)) {
                ws.close();
                return;
            }

            this._nextLinkClient = ws;

            const checkLoop = setInterval(() => {
                if (ws.data.clientId !== this._nextLinkClient?.data?.clientId) {
                    clearInterval(checkLoop);
                    ws.close();
                    return;
                }

                if (this._linkClient !== null) {
                    if (!this._lock) {
                        this._lock = true;
                        this.closed = true;
                        setTimeout(() => {
                            this._lock = false;
                            if (this._linkClient !== null) {
                                if (ws.data.clientId === this._linkClient?.data?.clientId) {
                                    this._linkClient.close();
                                    this._linkClient = null;
                                }
                            }
                        }, 100);
                    }
                }

                if (ws.data.clientId !== this._nextLinkClient?.data?.clientId) {
                    clearInterval(checkLoop);
                    ws.close();
                    return;
                }

                clearInterval(checkLoop);
                this._linkClient = this._nextLinkClient;
                this.closed = false;

                const fnc = this.routeMaps.get(src);
                if (fnc) {
                    fnc(this);
                }
            }, 10);
        } else {
            if (this._client !== null) {
                this._enable = false;
                this.formMsgSend("compileFail", "\r\n\r\n新的连接建立,自动断开");
                this._client.close();
            } else {
                this._enable = true;
            }
            this._client = ws;
            this._firstMsg = null;
        }
    }

    clientLeft(ws: any): void {
        if (ws.data.src === "/" && this._client?.data?.clientId === ws.data.clientId) {
            this._client = null;
            this.stateToWait();
        } else {
            if (this.routeMaps.has(ws.data.src)) {
                if (this._linkClient?.data?.clientId === ws.data.clientId) {
                    this.closed = true;
                    this._lock = true;
                    setTimeout(() => {
                        this._lock = false;
                        if (this._linkClient !== null) {
                            if (ws.data.clientId === this._linkClient?.data?.clientId) {
                                this._linkClient = null;
                                ws.close();
                            }
                        }
                    }, 100);
                }
            }
        }
    }

    messageReceived(ws: any, message: string | Buffer): void {
        const msg = message instanceof Buffer ? message.toString() : message;
        const src = ws.data.src;

        if (src !== "/") {
            this.linkMessageReceived(ws, msg);
            return;
        }

        if (msg.length === 0) return;

        if (msg[0] === USER_MSG) {
            this._server = ws.data.server;
            try {
                const data: MessageData = JSON.parse(msg.slice(1));

                if (data.type === "assets") {
                    void this.handleAssets(data);
                    return;
                }

                if (data.type === "conn") {
                    if (data.handle === "close") {
                        this._waitToClose = true;
                        const tempState = this._state;
                        this.stateToWait();
                        setTimeout(() => {
                            this._waitToClose = false;
                            if (tempState === State.READY) {
                                this.handleClose();
                            }
                            this.formMsgSend("compileFail", "连接终止");
                            if (this._client) {
                                this._client.close();
                            }
                            this._enable = true;
                        }, 200);
                        return;
                    }
                }

                if (this._client && ws.data.clientId === this._client.data.clientId) {
                    this._path = "";
                    if (data.projectId) {
                        const pid = data.projectId;
                        this._path = pid;
                        void this.waitForAssets(data, this._client.data.clientId);
                    }
                }
            } catch (e) {
                console.error("无法转译数据:", e);
            }
        } else if (msg[0] === INPUT && this._state === State.READY) {
            if (this._client && ws.data.clientId === this._client.data.clientId) {
                const inputMsg = msg.slice(1);

                if (inputMsg === "\r" || inputMsg === "\n") {
                    const wholeStr = this._tmpInputs.join("");
                    this._inputs.push(wholeStr);
                    this._tmpInputs = [];
                    this.sendToWeb(INPUT, "\r\n");
                } else if (inputMsg === "\u007F") {
                    if (this._tmpInputs.length > 0) {
                        const last = this._tmpInputs.pop()!;
                        const isCh = this.isChinese(last);
                        this.sendMvMsg(isCh);
                    }
                } else {
                    for (const c of inputMsg) {
                        this._tmpInputs.push(c);
                    }
                    this.sendToWeb(INPUT, inputMsg);
                }
            }
        } else {
            if (this._firstMsg === null) {
                this._firstMsg = msg;
                try {
                    const cookieObj = JSON.parse(this._firstMsg);
                    if ("cookies" in cookieObj) {
                        userInfo.cookie = cookieObj.cookies as string;
                        const userid = getUserId();
                        if (userid) {
                            setValueToConfig("info", userid);
                        }
                    }
                } catch (e) {
                    console.error("无法转译数据:", e);
                }
            }
        }
    }

    linkMessageReceived(ws: any, message: string): void {
        this._linkMessages.push(message);
    }

    isChinese(ch: string): boolean {
        const code = ch.charCodeAt(0);
        return code >= 0x4e00 && code <= 0x9fa5;
    }

    sendMsg(cmd: Cmd): void {
        if (this._state === State.READY || this._waitToClose) {
            if (cmd.type === "BackendEvent") {
                const preOutput = cmd.data?.replace(/\n/g, "\r\n") || "";
                this.sendToWeb(OUTPUT, preOutput);

                if (preOutput.includes(" * Running on")) {
                    const match = preOutput.match(/Running on (.+?) /);
                    if (match) {
                        const host = match[1].replace("0.0.0.0", "127.0.0.1");
                        const signalMsg = JSON.stringify({
                            type: "flask",
                            host: host,
                        });
                        this.formMsgSend("signal", signalMsg);
                    }
                }
            } else if ("inner_err" in cmd) {
                const errStr = cmd.inner_err;
                this.formMsgSend("runInfo", "\r\n" + errStr);
                this.stateToWait();
                this._client?.close();
            } else if ("err" in cmd && cmd.err) {
                const errStr = JSON.stringify(cmd.err);
                this.sendToWeb(USER_MSG, errStr);
                if (cmd.OutRaw) {
                    this.sendToWeb(OUTPUT, cmd.OutRaw.replace(/\n/g, "\r\n"));
                }
                this.stateToWait();
                this.formMsgSend("runInfo", "\r\n\r\n程序运行结束");
                this._client?.close();
            } else if ("command_name" in cmd) {
                if (cmd.command_name === "Run") {
                    this.handleClose();
                    this.formMsgSend("runInfo", "\r\n\r\n程序运行结束");
                    this._client?.close();
                    this._enable = true;
                    this.stateToWait();
                }
            }
        }
    }

    handleClose(): void {
        if (!this._am) return;

        const resTag = this._am.compareAssets();
        let msg: Record<string, unknown>;

        if (resTag === 1) {
            msg = { type: "file_err", reason: "oversize" };
        } else if (resTag === 2) {
            msg = { type: "file_err", reason: "count" };
        } else if (typeof resTag === "object" && resTag !== null) {
            msg = { ...resTag, type: "changed" };
        } else {
            msg = { type: "changed" };
        }

        this.formMsgSend("signal", JSON.stringify(msg));
    }

    closeCurClient(): void {
        if (this._client) {
            this._client.close();
        }
    }

    sendMvMsg(isc: boolean): void {
        const tag = isc ? "CCAICCAI" : "CCAI";
        const data = INPUT + tag;
        this._client?.send(data);
    }

    getState(): number {
        if (this._state === State.WAIT) {
            if (this._code !== null) {
                if (this._path !== null) {
                    if (this._enable) {
                        if (this._client !== null) {
                            this._state = State.READY;
                        }
                    }
                }
            }
        }
        return this._state;
    }

    getCodeAndPath(): [string | null, string | null, string | null] {
        return [this._code, this._path, this._firstMsg];
    }

    formMsgSend(comType: string, msg: string): void {
        const msgDic: FormMsg = { Type: comType, Info: msg };
        const msgStr = JSON.stringify(msgDic);
        this.sendToWeb(USER_MSG, msgStr);
    }

    formMsgSendToClient(comType: string, msg: string, client: any): void {
        const msgDic: FormMsg = { Type: comType, Info: msg };
        const msgStr = JSON.stringify(msgDic);
        const encoded = Buffer.from(msgStr).toString("base64");
        const data = USER_MSG + encoded;
        client.send(data);
    }

    sendToWeb(msgType: string, msg: string): void {
        if (!this._client) return;
        const encoded = Buffer.from(msg).toString("base64");
        const data = msgType + encoded;
        this._client.send(data);
    }

    poxyReady(): void {
        this._enable = true;
    }

    fetchNextInput(): string | undefined {
        return this._inputs.shift();
    }

    stateToWait(): void {
        this._state = State.WAIT;
        this._path = null;
        this._code = null;
    }

    async handleAssets(message: MessageData): Promise<boolean> {
        const pid = message.projectId as string;

        if (idDict.has(pid)) {
            if (idDict.get(pid) === AssetState.Checking) {
                return false;
            }
            idDict.set(pid, AssetState.Checking);
        } else {
            idDict.set(pid, AssetState.Checking);
        }

        const am = new AssetManage();
        this._am = am;

        const res = await am.handleAssetsJson(message as any);

        if (res.OK) {
            idDict.set(pid, AssetState.Ready);
            return true;
        }

        idDict.set(pid, AssetState.Error);
        this.formMsgSend("assets", "err");
        return false;
    }

    checkLoadTime(aid: number): void {
        setTimeout(() => {
            if (this._client !== null) {
                if (this._client.data.clientId === aid) {
                    if (!this.hasRun) {
                        this.formMsgSend("assets", "start");
                        this.loadFlag = false;
                    }
                }
            }
        }, 500);
    }

    async waitForAssets(message: MessageData, aid: number): Promise<void> {
        const pid = message.projectId as string;
        let cnt = 0;
        this.loadFlag = true;
        this.hasRun = false;

        while (
            idDict.has(pid) &&
            idDict.get(pid) === AssetState.Checking &&
            this._client !== null &&
            this._client.data.clientId === aid
        ) {
            cnt++;
            if (cnt === 100) {
                this.formMsgSend("assets", "start");
                this.loadFlag = false;
            }
            await new Promise((r) => setTimeout(r, 5));
        }

        if (this._client === null || this._client.data.clientId !== aid) {
            return;
        }

        if (this.loadFlag) {
            const res = await this.handleAssets(message);
            if (res) {
                idDict.set(pid, AssetState.Ready);
                if (this._code === null) {
                    this.formMsgSend("assets", "end");
                }
                this._code = message.xml as string;
                this.hasRun = true;
            } else {
                idDict.set(pid, AssetState.Error);
                this.stateToWait();
                this._client?.close();
            }
        } else {
            const res = await this.handleAssets(message);
            if (res) {
                idDict.set(pid, AssetState.Ready);
            } else {
                idDict.set(pid, AssetState.Error);
            }

            if (this._client !== null) {
                if (this._client.data.clientId === aid) {
                    if (res) {
                        if (this._code === null) {
                            this.formMsgSend("assets", "end");
                        }
                        this._code = message.xml as string;
                        this.hasRun = true;
                    } else {
                        this.stateToWait();
                        this._client?.close();
                    }
                }
            }
        }
    }

    send(message: string | Buffer): void {
        if (!this.closed && this._linkClient) {
            const msg = message instanceof Buffer ? message.toString() : message;
            this._linkClient.send(msg);
        }
    }

    receive(): string | undefined {
        if (this.closed) return undefined;
        return this._linkMessages.shift();
    }
}

const userInfo: { cookie?: string } = {};

let _webttyInstance: Webtty | null = null;

export function getWebtty(): Webtty | null {
    return _webttyInstance;
}

function setWebtty(webtty: Webtty): void {
    _webttyInstance = webtty;
}

function getUserId(): string | null {
    return null;
}

function setValueToConfig(config: string, stuId?: string): void {
    console.log(`设置配置: ${config}, stuId: ${stuId}`);
}

export interface WebSocketServerOptions {
    port?: number;
    webtty?: Webtty;
}

export interface WebSocketServerResult {
    server: Server<WebSocketData>;
    webtty: Webtty;
}

export function createWebSocketHandlers(webtty: Webtty = new Webtty()) {
    return {
        open(ws: any) {
            webtty.newClient(ws);
        },
        message(ws: any, message: string | Buffer) {
            webtty.messageReceived(ws, message);
        },
        close(ws: any) {
            webtty.clientLeft(ws);
        },
        drain(ws: any) {},
    };
}

export function createFetchHandler(webtty: Webtty = new Webtty()) {
    return (req: Request, server: Server<WebSocketData>) => {
        const url = new URL(req.url);
        if (url.pathname === "/ws" || req.headers.get("upgrade") === "websocket") {
            const clientId = ++clientIdCounter;
            const success = server.upgrade(req, {
                data: { clientId, src: "/", server },
            });
            if (success) return;
            return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return new Response("Not Found", { status: 404 });
    };
}
