import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

// Helper to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Basic Shutdown Logic", () => {
    test("should shut down after sleep time", async (t) => {
        const app = Fastify();
        let closeCalled = false;

        app.addHook("onClose", async () => {
            closeCalled = true;
        });

        // Use a very short sleep time for testing
        // Mock process.exit to avoid killing the test runner
        const originalExit = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
        };

        try {
            // Note: We need to use force: false so we don't kill the test runner's open handles if they share ref
            // But actually, we just want to verify app.close() is called.
            // The plugin calls process.exit(0) at the end of shutdown().

            await app.register(autoShutdown, {
                sleep: 0.1, // 100ms
                grace: 0,
                jitter: 0,
                reportLoad: false,
            });

            // We need to listen for the timer to start
            await app.listen({ port: 0, host: "127.0.0.1" });

            // Wait for shutdown (sleep 100ms + buffer)
            await sleep(300);

            assert.strictEqual(closeCalled, true, "Fastify close hook should have been called");
            assert.strictEqual(exitCode, 0, "Process should have exited with code 0");
        } finally {
            await app.close().catch(() => { });
            process.exit = originalExit;
        }
    });

    test("requests should delay shutdown", async (t) => {
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
            });

            app.get("/", async (req, reply) => {
                await sleep(150); // Take 150ms
                return "ok";
            });

            await app.listen({ port: 0, host: "127.0.0.1" });
            const port = app.server.address().port;

            // Start a request immediately
            fetch(`http://127.0.0.1:${port}/`).catch(() => { });

            // By 100ms, request is still in flight (taking 150ms).
            // Timer shouldn't even be scheduled until response finishes at ~150ms.
            // Then +200ms sleep = ~350ms total.

            await sleep(250);
            assert.strictEqual(closeCalled, false, "Should not be closed yet (request delayed it)");

            // Wait enough time for it to close
            await sleep(300); // 250 + 300 = 550ms, well past 350
            assert.strictEqual(closeCalled, true, "Should be closed now");
        } finally {
            await app.close().catch(() => { });
            process.exit = originalExit;
        }
    });
});
