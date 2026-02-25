import { httpPort } from "../..";
import { AssetManage, getLocalPath } from "../doanload/downloadAssets";

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
