import * as handle from "./handleHttp";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(handler: (req: Request) => Response | Promise<Response>) {
    return async (req: Request) => {
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        const response = await handler(req);

        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    };
}

export const routers = {
    "/": withCors(() => {
        return new Response("欢迎使用更好的学而思编程助手\n版本号: 0.0.1");
    }),
    "/ping": withCors(handle.ping),
    "/version": withCors(handle.version),
    "/path": withCors(handle.path),
};
