
import { test, describe } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Shutdown Hook Safety", () => {
    test("hanging hook should not prevent shutdown (timeout)", async (t) => {
        const app = Fastify();
        let closeCalled = false;
        app.addHook("onClose", async () => {
            closeCalled = true;
        });

        const originalExit = process.exit;
        process.exit = () => { };

        try {
            await app.register(autoShutdown, {
                sleep: 0.1,
                grace: 0,
                jitter: 0,
                hookTimeout: 200, // 200ms timeout for hooks
            });

            // Add a hanging hook
            app.onAutoShutdown(async () => {
                await sleep(1000); // 1 second (longer than 200ms timeout)
                return false; // try to veto, but should be too late
            });

            await app.listen({ port: 0, host: "127.0.0.1" });

            // Wait for sleep (100ms) + timeout (200ms) + buffer
            await sleep(500);

            assert.strictEqual(closeCalled, true, "Shutdown should have proceeded despite hanging hook");
        } finally {
            process.exit = originalExit;
        }
    });

    test("fast hook works normally (veto)", async (t) => {
        const app = Fastify();
        let closeCalled = false;
        app.addHook("onClose", async () => {
            closeCalled = true;
        });

        const originalExit = process.exit;
        process.exit = () => { };

        try {
            await app.register(autoShutdown, {
                sleep: 0.1,
                grace: 0,
                jitter: 0,
                hookTimeout: 1000, // 1s timeout
            });

            app.onAutoShutdown(async () => {
                return false; // veto immediately
            });

            await app.listen({ port: 0, host: "127.0.0.1" });

            await sleep(300);

            assert.strictEqual(closeCalled, false, "Shutdown should have been cancelled by veto");

            await app.close();
        } finally {
            process.exit = originalExit;
        }
    });
});
