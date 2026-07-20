import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import { createHeartbeatController } from "../src/heartbeat.js";
import autoShutdown from "../src/plugin.js";
import { createState } from "../src/state.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Load Reporting Logic", () => {
    test("should send heartbeat via process.send", async (t) => {
        const app = Fastify();

        // Mock process.send since we are not in a child process
        const originalSend = process.send;
        let receivedMsg = null;
        process.send = (msg) => {
            receivedMsg = msg;
        };

        try {
            await app.register(autoShutdown, {
                sleep: 10,
                grace: 0,
                reportLoad: true,
                heartbeatInterval: 50, // 50ms
            });

            await app.listen({ port: 0, host: "127.0.0.1" });

            await sleep(100);

            assert.ok(receivedMsg, "Should have received a message");
            assert.strictEqual(receivedMsg.cmd, "heartbeat");
            assert.ok(typeof receivedMsg.lag === "number");
            assert.ok(receivedMsg.memory);

            await app.close();
        } finally {
            if (originalSend) {
                process.send = originalSend;
            } else {
                delete process.send;
            }
        }
    });

    test("continues memory enforcement after parent IPC disconnects", async () => {
        const state = createState();
        const originalConnected = Object.getOwnPropertyDescriptor(process, "connected");
        Object.defineProperty(process, "connected", { value: false, configurable: true });
        let shutdowns = 0;
        const heartbeat = createHeartbeatController({
            state,
            reportLoad: false,
            memoryLimit: Number.MIN_VALUE,
            heartbeatInterval: 10,
            log: { debug() {}, warn() {} },
            shutdown: async () => {
                ++shutdowns;
                state.isShuttingDown = true;
            },
        });

        try {
            heartbeat.startHeartbeat();
            await sleep(35);

            assert.strictEqual(shutdowns, 1);
            assert.strictEqual(state.intervalTimer, null);
        } finally {
            heartbeat.stopHeartbeat();
            if (originalConnected) {
                Object.defineProperty(process, "connected", originalConnected);
            } else {
                delete process.connected;
            }
        }
    });
});
