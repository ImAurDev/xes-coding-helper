import * as handle from "./handleHttp";
import index from "../webui/index.html";
import { findAllPythonPaths, getSavedPythonPath, savePythonPath } from "../python/runner";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

let serverError: { message: string; type: string } | null = null;

export function setServerError(error: { message: string; type: string } | null) {
    serverError = error;
}

export function getServerError() {
    return serverError;
}

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

async function getPythonPaths(req: Request) {
    const paths = await findAllPythonPaths();
    const savedPath = await getSavedPythonPath();
    return Response.json({ paths, savedPath });
}

async function setPythonPath(req: Request) {
    try {
        const body = await req.json();
        if (body.path) {
            await savePythonPath(body.path);
            return Response.json({ success: true });
        }
        return Response.json({ success: false, error: "路径不能为空" }, { status: 400 });
    } catch (e) {
        return Response.json({ success: false, error: "请求格式错误" }, { status: 400 });
    }
}

async function getStatus(req: Request) {
    return Response.json({ error: serverError });
}

export const routers = {
    "/": index,
    "/ping": withCors(handle.ping),
    "/version": withCors(handle.version),
    "/path": withCors(handle.path),
    "/package/search": withCors(handle.searchPkg),
    "/package/local": withCors(handle.getList),
    "/package/err": withCors(handle.getErrList),
    "/package/clear": withCors(handle.clear),
    "/package/err/delete": withCors(handle.removePkg),
    "/package/install": withCors(handle.installPkg),
    "/package/uninstall": withCors(handle.uninstallPkg),
    "/package/cancel": withCors(handle.cancelInstallPkg),
    "/package/state": withCors(handle.getState),
    "/package/all_state": withCors(handle.getAllState),
    "/package/unlock": withCors(handle.unlock),
    "/package/mirrors": withCors(handle.getMirrors),
    "/package/mirrors/choose": withCors(handle.chooseMirror),
    // "/assets/dict": withCors(assetsDict),
    // "/intelligence": withCors(intelligence),
    "/api/python-paths": withCors(getPythonPaths),
    "/api/python-path": withCors(setPythonPath),
    "/api/status": withCors(getStatus),
};
