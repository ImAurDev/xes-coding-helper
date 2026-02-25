export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function withCors(handler: (req: Request) => Response | Promise<Response>) {
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
