import assert from "node:assert/strict";
import { test } from "node:test";

import { createShutdownHandler } from "../src/shutdown.js";

function createAbandonHarness() {
    const completeEvents = [];
    const warnLogs = [];
    const errorLogs = [];
    let resolveClose;
    let rejectClose;
    const closePromise = new Promise((resolve, reject) => {
        resolveClose = resolve;
        rejectClose = reject;
    });
    const state = { isShuttingDown: false, inFlight: 0, nextAt: 1234 };
    const shutdown = createShutdownHandler({
        state,
        fastify: {
            close: () => closePromise,
            server: { closeIdleConnections() {} },
        },
        log: {
            debug() {},
            info() {},
            warn: (...args) => warnLogs.push(args),
            error: (...args) => errorLogs.push(args),
        },
        force: false,
        closeTimeout: 10,
        exitProcess: false,
        shutdownHooks: [],
        shutdownStartHooks: [],
        shutdownCompleteHooks: [(event) => completeEvents.push(event)],
        runHookWithTimeout: async (hook, args) => hook(...args),
        runLifecycleHooks: async (hooks, event) => {
            for (const hook of hooks) {
                await hook(event);
            }
        },
        schedule() {},
        cancel() {},
        startHeartbeat() {},
        stopHeartbeat() {},
    });
    return { shutdown, completeEvents, warnLogs, errorLogs, resolveClose, rejectClose };
}

function createHarness({ force }) {
    const completeEvents = [];
    let resolveClose;
    let forced = 0;
    const closePromise = new Promise((resolve) => {
        resolveClose = resolve;
    });
    const state = { isShuttingDown: false, inFlight: 0, nextAt: 1234 };
    const fastify = {
        close: () => closePromise,
        server: {
            closeIdleConnections() {},
            closeAllConnections() {
                ++forced;
                resolveClose();
            },
        },
    };
    const shutdown = createShutdownHandler({
        state,
        fastify,
        log: { warn() {}, info() {}, error() {} },
        force,
        closeTimeout: 10,
        exitProcess: false,
        shutdownHooks: [],
        shutdownStartHooks: [],
        shutdownCompleteHooks: [(event) => completeEvents.push(event)],
        runHookWithTimeout: async (hook, args) => hook(...args),
        runLifecycleHooks: async (hooks, event) => {
            for (const hook of hooks) {
                await hook(event, fastify);
            }
        },
        schedule() {},
        cancel() {
            state.nextAt = null;
        },
        startHeartbeat() {},
        stopHeartbeat() {},
    });
    return {
        shutdown,
        completeEvents,
        get forced() {
            return forced;
        },
    };
}

test("force closes active connections after the graceful close deadline", async () => {
    const harness = createHarness({ force: true });
    await harness.shutdown();

    assert.strictEqual(harness.forced, 1);
    assert.strictEqual(harness.completeEvents[0].outcome, "closed");
    assert.strictEqual(harness.completeEvents[0].nextAt, 1234);
});

test("reports a bounded close error when force is disabled", async () => {
    const harness = createHarness({ force: false });
    await harness.shutdown();

    assert.strictEqual(harness.forced, 0);
    assert.strictEqual(harness.completeEvents[0].outcome, "error");
    assert.strictEqual(harness.completeEvents[0].error.code, "AUTOSHUTDOWN_CLOSE_TIMEOUT");
});

test("logs late completion of a close abandoned after its timeout", async () => {
    const harness = createAbandonHarness();
    await harness.shutdown();

    assert.strictEqual(harness.completeEvents[0].outcome, "error");

    harness.resolveClose();
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(
        harness.warnLogs.some(
            (args) => args[0] === "Fastify close completed after its timeout was reported",
        ),
        "late close completion must be logged",
    );
});

test("logs late failure of a close abandoned after its timeout", async () => {
    const harness = createAbandonHarness();
    await harness.shutdown();

    assert.strictEqual(harness.completeEvents[0].outcome, "error");

    const lateError = new Error("close blew up later");
    harness.rejectClose(lateError);
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(
        harness.errorLogs.some(
            (args) =>
                args[0]?.err === lateError &&
                args[1] === "Fastify close failed after its timeout was reported",
        ),
        "late close failure must be logged",
    );
});
