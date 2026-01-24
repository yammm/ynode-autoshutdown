
import { test, describe } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

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
        if (originalSend) {
            process.send = originalSend;
        } else {
            delete process.send;
        }
    });
});
