import { describe, test } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Shutdown Re-entry Protection", () => {
    test("repeated reset attempts during shutdown do not trigger extra closes", async () => {
        const app = Fastify();

        const originalExit = process.exit;
        process.exit = () => { };

        let closeCalls = 0;

        try {
            await app.register(autoShutdown, {
                sleep: 0.05,
                grace: 0,
                jitter: 0,
                exitProcess: false,
            });

            const originalClose = app.close.bind(app);
            app.close = async (...args) => {
                closeCalls += 1;
                await sleep(120);
                return originalClose(...args);
            };

            app.onAutoShutdown(async () => {
                // Attempt to re-arm while shutdown is already in progress.
                for (let i = 0; i < 5; i++) {
                    app.autoshutdown.reset();
                    await sleep(10);
                }
            });

            await app.ready();
            app.autoshutdown.reset();

            await sleep(260);

            assert.strictEqual(closeCalls, 1, "close should only run once while shutting down");
        } finally {
            process.exit = originalExit;
            await app.close().catch(() => { });
        }
    });
});
