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
        throw error;
    }
}
