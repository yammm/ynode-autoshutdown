import { describe, test } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Shutdown Re-entry Protection", () => {
    test("repeated shutdown triggers only close once", async () => {
        const app = Fastify();

        const originalExit = process.exit;
        process.exit = () => { };

        const originalMemoryUsage = process.memoryUsage;
        process.memoryUsage = () => ({
            rss: 300 * 1024 * 1024,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0,
        });

        let closeCalls = 0;

        try {
            await app.register(autoShutdown, {
                sleep: 10,
                grace: 0,
                jitter: 0,
                memoryLimit: 200,
                heartbeatInterval: 20,
            });

            const originalClose = app.close.bind(app);
            app.close = async (...args) => {
                closeCalls += 1;
                await sleep(120);
                return originalClose(...args);
            };

            await app.listen({ port: 0, host: "127.0.0.1" });

            await sleep(250);

            assert.strictEqual(closeCalls, 1, "close should only run once while shutting down");
        } finally {
            process.exit = originalExit;
            process.memoryUsage = originalMemoryUsage;
            await app.close().catch(() => { });
        }
    });
});
