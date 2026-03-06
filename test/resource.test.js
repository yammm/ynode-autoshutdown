
import { test, describe } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Resource Based Shutdown", () => {
    test("should shutdown if memory limit is exceeded", async (t) => {
        const app = Fastify();
        let closeCalled = false;
        app.addHook("onClose", async () => {
            closeCalled = true;
        });

        // Mock process.exit
        const originalExit = process.exit;
        process.exit = () => { };

        // Mock process.memoryUsage
        const originalMemoryUsage = process.memoryUsage;
        let mockRss = 100 * 1024 * 1024; // Start at 100MB
        process.memoryUsage = () => ({
            rss: mockRss,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0
        });

        try {
            await app.register(autoShutdown, {
                sleep: 10,
                grace: 0,
                jitter: 0,
                reportLoad: false, // ensure monitoring works even if reportLoad is false
                memoryLimit: 200, // 200MB limit
                heartbeatInterval: 50, // fast check
            });

            await app.listen({ port: 0, host: "127.0.0.1" });

            // Wait a bit, memory is 100MB < 200MB
            await sleep(100);
            assert.strictEqual(closeCalled, false, "Should be running (100MB < 200MB)");

            // Spike memory to 300MB
            mockRss = 300 * 1024 * 1024;

            // Wait for next check
            await sleep(200);

            assert.strictEqual(closeCalled, true, "Should have closed due to memory limit");
        } finally {
            process.exit = originalExit;
            process.memoryUsage = originalMemoryUsage;
        }
    });
});
