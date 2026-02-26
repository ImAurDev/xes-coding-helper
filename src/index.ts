import { routers, setServerError } from "./lib/http/httpRouter";
import { isPortAvailable } from "./lib/http/port";
import { Runner } from "./lib/python/runner";
import { Webtty, type WebSocketData } from "./lib/websocket/websocket";

export let httpPort = 0;
let wsPort = 0;

const ports = [
    { port: 55820, port2: 55821 },
    { port: 55825, port2: 55826 },
    { port: 55830, port2: 55831 },
    { port: 55835, port2: 55836 },
];

async function findAvailablePorts(): Promise<{ httpPort: number; wsPort: number } | null> {
    for (const { port, port2 } of ports) {
        try {
            const [first, second] = await Promise.all([
                isPortAvailable(port),
                isPortAvailable(port2),
            ]);

            if (first && second) {
                return { httpPort: port, wsPort: port2 };
            }
        } catch (error) {
            console.error("检查端口是否可用时错误: ", error);
        }
    }
    return null;
}

async function startServer() {
    const result = await findAvailablePorts();

    if (!result) {
        setServerError({ message: "未找到可用端口，请关闭其他占用端口的程序", type: "port" });
        httpPort = 0;
        wsPort = 0;
    } else {
        httpPort = result.httpPort;
        wsPort = result.wsPort;
    }

    const httpServer = Bun.serve({
        port: httpPort,
        routes: routers
    });

    const webtty = new Webtty();
    const runner = new Runner({ webtty, pythonPath: "python" });
    runner.start();

    if (wsPort > 0) {
        const wsServer = Bun.serve<WebSocketData>({
            port: wsPort,
            fetch(req, server) {
                const url = new URL(req.url);
                if (req.headers.get("upgrade") === "websocket") {
                    server.upgrade(req, {
                        data: { clientId: Date.now(), src: "/", server },
                    });
                    return;
                }
                return new Response("未找到", { status: 404 });
            },
            websocket: {
                open(ws) {
                    webtty.newClient(ws);
                },
                message(ws, msg) {
                    webtty.messageReceived(ws, msg);
                },
                close(ws) {
                    webtty.clientLeft(ws);
                },
                drain(ws) {},
            },
        });
    }

    console.log("欢迎使用 更好的学而思编程助手 v0.0.0.2\n作者: 极光");
    if (httpPort > 0) {
        console.log(`HTTP 服务运行在端口 ${httpPort}`);
        console.log(`WebSocket 服务运行在端口 ${wsPort}`);
    } else {
        console.log("HTTP 服务启动失败: 未找到可用端口");
    }
}

startServer();
