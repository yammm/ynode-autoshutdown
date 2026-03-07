import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Feature Options", () => {
    test("exitProcess=false closes Fastify without calling process.exit", async () => {
        const app = Fastify();
        let closeCalled = false;
        app.addHook("onClose", async () => {
            closeCalled = true;
        });

        const originalExit = process.exit;
        let exitCalled = false;
        process.exit = () => {
            exitCalled = true;
        };

        try {
            await app.register(autoShutdown, {
                sleep: 0.05,
                grace: 0,
                jitter: 0,
                exitProcess: false,
            });

            await app.ready();
            app.autoshutdown.reset();
            await sleep(160);

            assert.strictEqual(closeCalled, true);
            assert.strictEqual(exitCalled, false);
        } finally {
            process.exit = originalExit;
            await app.close().catch(() => {});
        }
    });

    test("exitProcess=true triggers process.exit(0) after shutdown", async () => {
        const app = Fastify();

        const originalExit = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
        };

        try {
            await app.register(autoShutdown, {
                sleep: 0.05,
                grace: 0,
                jitter: 0,
                exitProcess: true,
            });

            await app.ready();
            app.autoshutdown.reset();
            await sleep(160);

            assert.strictEqual(exitCode, 0);
        } finally {
            process.exit = originalExit;
            await app.close().catch(() => {});
        }
    });

    test("lifecycle hooks receive start and complete events", async () => {
        const app = Fastify();
        const startEvents = [];
        const completeEvents = [];

        await app.register(autoShutdown, {
            sleep: 0.05,
            grace: 0,
            jitter: 0,
            exitProcess: false,
            onShutdownStart: async (event) => {
                startEvents.push(event);
            },
            onShutdownComplete: async (event) => {
                completeEvents.push(event);
            },
        });

        await app.ready();
        app.autoshutdown.reset();
        await sleep(160);

        assert.strictEqual(startEvents.length, 1);
        assert.strictEqual(completeEvents.length, 1);
        assert.strictEqual(startEvents[0].trigger, "idle_timer");
        assert.strictEqual(completeEvents[0].outcome, "closed");
        assert.ok(completeEvents[0].durationMs >= 0);

        await app.close().catch(() => {});
    });

    test("lifecycle complete event reports vetoed outcome", async () => {
        const app = Fastify();
        const completeEvents = [];
        let vetoOnce = true;

        await app.register(autoShutdown, {
            sleep: 0.05,
            grace: 0,
            jitter: 0,
            exitProcess: false,
            onShutdownComplete: async (event) => {
                completeEvents.push(event);
            },
        });

        app.onAutoShutdown(async () => {
            if (vetoOnce) {
                vetoOnce = false;
                return false;
            }
        });

        await app.ready();
        app.autoshutdown.reset();
        await sleep(180);

        assert.ok(
            completeEvents.some((event) => event.outcome === "vetoed"),
            "expected at least one vetoed completion event",
        );

        await app.close().catch(() => {});
    });

    test("function-based ignore matcher can ignore timer logic", async () => {
        const app = Fastify();

        app.get("/health", async () => "ok");
        app.get("/work", async () => "ok");

        await app.register(autoShutdown, {
            sleep: 60,
            grace: 0,
            jitter: 0,
            ignore: (request, path) => request.method === "GET" && path === "/health",
        });

        await app.ready();

        app.autoshutdown.reset();
        const initialNextAt = app.autoshutdown.nextAt;
        assert.ok(typeof initialNextAt === "number");

        await app.inject({
            method: "GET",
            url: "/health?probe=1",
        });
        assert.strictEqual(app.autoshutdown.nextAt, initialNextAt, "ignored matcher request should not modify timer");

        await app.inject({
            method: "GET",
            url: "/work",
        });
        assert.ok(app.autoshutdown.nextAt > initialNextAt);

        await app.close();
    });
});
