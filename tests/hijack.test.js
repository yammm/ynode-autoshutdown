import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchRaw({ port, path }) {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path }, (res) => {
            let body = "";
            res.on("data", (chunk) => {
                body += chunk;
            });
            res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.end();
    });
}

test("hijacked replies settle in-flight accounting when the connection closes", async () => {
    const app = Fastify();
    app.get("/stream", (request, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, { "content-type": "text/plain", connection: "close" });
        reply.raw.end("streamed");
    });

    await app.register(autoShutdown, {
        sleep: 10,
        grace: 0,
        jitter: 0,
        exitProcess: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });

    try {
        const body = await fetchRaw({ port: app.server.address().port, path: "/stream" });
        assert.strictEqual(body, "streamed");

        // onResponse never fires for hijacked replies; the raw close fallback must settle.
        let settled = false;
        for (let attempt = 0; attempt < 50; ++attempt) {
            if (app.autoshutdown.inFlight === 0) {
                settled = true;
                break;
            }
            await sleep(20);
        }
        assert.ok(settled, "hijacked reply should not pin inFlight");
        assert.strictEqual(typeof app.autoshutdown.nextAt, "number", "idle timer must re-arm");
    } finally {
        await app.close();
    }
});
