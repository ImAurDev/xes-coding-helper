import { httpPort } from "../..";
import { AssetManage, getLocalPath } from "../doanload/downloadAssets";
import { packList } from "../python/package/lib_list";
import { pkgManager } from "../python/package/package_manager";

export function ping() {
    return Response.json({ auto: true });
}

export function version() {
    return Response.json({ version: "2.13" });
}

export async function path(req: Request) {
    try {
        const packageInfo = await req.text();
        const args = JSON.parse(packageInfo);

        if (!args.id) return new Response("资源不存在", { status: 404 });
        if (!args.message) return new Response("缺少资源信息", { status: 400 });

        const assetManager = new AssetManage();
        const result = await assetManager.handleAssetsJson(args.message);
        if (!result.OK) return new Response("资源处理失败", { status: 400 });

        const pid = args?.project_id || 6;
        const port = httpPort + 4;

        const res = await getLocalPath(pid, args.id);
        if (!res) return new Response("资源不存在", { status: 404 });

        return new Response(`http://127.0.0.1:${port}/${res}`);
    } catch (error) {
        console.error("获取资源路径时错误: ", error);
        return new Response("资源未找到", { status: 404 });
    }
}

export async function searchPkg(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    if (!name) {
        return Response.json({ status_code: 400, message: "缺少查询名称" }, { status: 400 });
    }

    const exactFlag = url.searchParams.get("exact_flag") === "true";
    try {
        const res = await packList.searchHandler(name, exactFlag);
        return Response.json({ status_code: 200, data: res });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export async function getList(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pageId = url.searchParams.get("page_id") || "";
    const msg = await packList.getPackList(pageId);
    if (msg === false) {
        return Response.json({ status_code: 1001, message: "该服务被锁定" }, { status: 400 });
    }
    return Response.json({ data: msg });
}

export function getErrList(): Response {
    const msg = packList.getErrList();
    return Response.json({ data: msg });
}

export async function clear(): Promise<Response> {
    try {
        return Response.json({ data: "success" });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export async function removePkg(req: Request): Promise<Response> {
    try {
        const body = await req.json();
        if (!body.name) {
            return Response.json({ status_code: 400, message: "缺少参数" }, { status: 400 });
        }
        packList.removeErrPack(body.name);
        return Response.json({ data: "Delete Success" });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export async function installPkg(req: Request): Promise<Response> {
    try {
        const body = await req.json();
        if (!body.name) {
            return Response.json({ status_code: 400, message: "缺少参数" }, { status: 400 });
        }

        const version = body.version || "";
        const desc = body.desc || "";
        const pageId = body.page_id || "";

        const res = await packList.installHandler(body.name, version, desc, pageId);
        if (res === false) {
            return Response.json({ status_code: 1001, message: "该服务被锁定" }, { status: 400 });
        }
        return Response.json({ data: { state: res } });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export async function uninstallPkg(req: Request): Promise<Response> {
    try {
        const body = await req.json();
        if (!body.name) {
            return Response.json({ status_code: 400, message: "缺少参数" }, { status: 400 });
        }
        await packList.uninstallHandler(body.name);
        return Response.json({ data: "Uninstall Success" });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export async function cancelInstallPkg(req: Request): Promise<Response> {
    try {
        const body = await req.json();
        if (!body.name) {
            return Response.json({ status_code: 400, message: "缺少参数" }, { status: 400 });
        }
        await packList.cancelInstallHandler(body.name);
        return Response.json({ data: { state: "waiting" } });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export function getState(req: Request): Response {
    const url = new URL(req.url);
    const pre = url.searchParams.get("pre") || "";
    const data = packList.getState(pre, true);
    return Response.json({ data });
}

export async function getAllState(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pageId = url.searchParams.get("page_id") || "";
    const data = await packList.getAllState(pageId);
    if (data === false) {
        return Response.json({ status_code: 1001, message: "该服务被锁定" }, { status: 400 });
    }
    return Response.json({ data });
}

export async function unlock(req: Request): Promise<Response> {
    try {
        const body = await req.json();
        const pageId = body.page_id || "";
        packList.unlock(pageId);
        return Response.json({ data: "ok" });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}

export function getMirrors(): Response {
    const mirrors = pkgManager.getMirrors();
    return Response.json({ data: mirrors });
}

export async function chooseMirror(req: Request): Promise<Response> {
    try {
        const body = await req.json();
        if (body.index === undefined) {
            return Response.json({ status_code: 400, message: "缺少参数" }, { status: 400 });
        }
        pkgManager.setMirrorIndex(body.index);
        return Response.json({ data: "ok" });
    } catch (e) {
        return Response.json({ status_code: 400, message: String(e) }, { status: 400 });
    }
}