export async function isPortAvailable(port: number): Promise<boolean> {
    try {
        const server = Bun.listen({
            hostname: "0.0.0.0",
            port,
            socket: {
                data() {},
            },
        });

        server.stop();
        return true;
    } catch (error) {
        if ((error as { code?: string })?.code === "EADDRINUSE") return false;
        if ((error as { code?: string })?.code === "EACCES") {
            console.error("端口被占用，可能是其他程序正在使用该端口");
            return false;
        }
        throw error;
    }
}
