
import { test, describe } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Ignore URLs Logic", () => {
    test("requests to ignored URLs should NOT delay shutdown", async (t) => {
        const app = Fastify();
        let closeCalled = false;
        app.addHook("onClose", async () => {
            closeCalled = true; 
        });

        const originalExit = process.exit;
        process.exit = () => { };

        try {
            await app.register(autoShutdown, {
                sleep: 0.2, // 200ms
                grace: 0,
                jitter: 0,
                ignoreUrls: ["/health", /\/admin\/.*/],
            });

            app.get("/health", async () => "ok");
            app.get("/admin/status", async () => "ok");
            app.get("/normal", async () => "ok");

            await app.listen({ port: 0, host: "127.0.0.1" });
            const port = app.server.address().port;

            // Start a request to /health immediately
            // It shouldn't count as in-flight for the purpose of resetting the timer logic (technically it might inc inFlight but the timer isn't cancelled/reset if logic follows)
            // Actually, looking at code:
            // onRequest: if ignored, return (don't increment inFlight, don't cancel timer)
            // onResponse: if ignored, return (don't decrement)

            // So effectively, the timer keeps running.

            await fetch(`http://127.0.0.1:${port}/health`);
            await fetch(`http://127.0.0.1:${port}/admin/status`);

            // Wait 250ms. Sleep is 200. Since requests were ignored, it should close.
            await sleep(250);
            assert.strictEqual(closeCalled, true, "Should close because requests were ignored");
        } finally {
            process.exit = originalExit;
        }
    });
});
