import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import { createHeartbeatController } from "../src/heartbeat.js";
import { registerHooks } from "../src/hooks.js";
import autoShutdown from "../src/plugin.js";
import { createState } from "../src/state.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Grace Period Logic", () => {
    test("should not shut down during grace period even if idle", async (t) => {
        const app = Fastify();
        let closeCalled = false;
        app.addHook("onClose", async () => {
            closeCalled = true;
        });

        const originalExit = process.exit;
        process.exit = () => {};

        try {
            await app.register(autoShutdown, {
                sleep: 0.1, // 100ms
                grace: 0.5, // 500ms
                jitter: 0,
            });

            await app.listen({ port: 0, host: "127.0.0.1" });

            // At 200ms, sleep (100ms) has passed, but grace (500ms) hasn't.
            await sleep(200);
            assert.strictEqual(closeCalled, false, "Should be in grace period");

            // Wait for grace to end (500ms) + sleep (100ms) + buffer
            await sleep(500);
            assert.strictEqual(closeCalled, true, "Should have closed after grace period ended");
        } finally {
            process.exit = originalExit;
        }
    });

    test("should delay heartbeat start until grace period ends", async (t) => {
        const app = Fastify();

        const originalSend = process.send;
        const msgs = [];
        process.send = (msg) => {
            msgs.push(msg);
        };

        const originalExit = process.exit;
        process.exit = () => {};

        try {
            await app.register(autoShutdown, {
                sleep: 10,
                grace: 0.2, // 200ms
                jitter: 0,
                reportLoad: true,
                heartbeatInterval: 50, // Fast heartbeat
            });

            await app.listen({ port: 0, host: "127.0.0.1" });

            // At 100ms, grace not over. Should contain NO heartbeats.
            await sleep(100);
            const countAt100 = msgs.length;
            assert.strictEqual(countAt100, 0, "No heartbeats during grace period");

            // Wait for grace (200ms) + some intervals
            await sleep(300);
            assert.ok(msgs.length > 0, "Heartbeats should start after grace period");

            await app.close();
        } finally {
            process.send = originalSend;
            process.exit = originalExit;
        }
    });

    test("should not restart heartbeat after shutdown during grace period", async () => {
        const hooks = new Map();
        const fastify = {
            addHook(name, handler) {
                hooks.set(name, handler);
            },
        };
        const state = createState();

        const msgs = [];
        const originalSend = process.send;
        process.send = (msg) => {
            msgs.push(msg);
        };

        const heartbeat = createHeartbeatController({
            state,
            reportLoad: true,
            memoryLimit: 0,
            heartbeatInterval: 25,
            log: { warn() {} },
            shutdown: async () => {},
        });

        registerHooks({
            fastify,
            state,
            grace: 0.05,
            log: { debug() {}, warn() {} },
            normalizePath: (path) => path,
            shouldIgnoreRequest: () => false,
            schedule: () => {},
            cancel: () => {},
            startHeartbeat: heartbeat.startHeartbeat,
            stopHeartbeat: heartbeat.stopHeartbeat,
        });

        try {
            await hooks.get("onListen")();
            await hooks.get("preClose")();
            await hooks.get("onClose")();

            await sleep(120);
            assert.strictEqual(msgs.length, 0, "Heartbeats should stay stopped after shutdown");
            assert.strictEqual(
                state.intervalTimer,
                null,
                "No heartbeat interval should be left running",
            );
            assert.strictEqual(state.graceTimer, null, "Grace timer should be cleared on shutdown");
        } finally {
            heartbeat.stopHeartbeat();
            process.send = originalSend;
        }
    });
});
