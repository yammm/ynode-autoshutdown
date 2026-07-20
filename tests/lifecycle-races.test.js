import assert from "node:assert/strict";
import { test } from "node:test";

import { registerHooks } from "../src/hooks.js";
import { createShutdownHandler } from "../src/shutdown.js";
import { createState } from "../src/state.js";

const log = { debug() {}, info() {}, warn() {}, error() {} };

test("external close remains terminal while veto completion is pending", async () => {
    const state = createState();
    state.nextAt = 1234;
    const hooks = new Map();
    const fastify = {
        addHook(name, handler) {
            hooks.set(name, handler);
        },
        async close() {
            throw new Error("vetoed shutdown must not close Fastify");
        },
    };
    let heartbeatStarts = 0;
    let schedules = 0;

    registerHooks({
        fastify,
        state,
        grace: 0,
        log,
        normalizePath: (path) => path,
        shouldIgnoreRequest: () => false,
        schedule: () => {
            ++schedules;
        },
        cancel: () => {
            state.nextAt = null;
        },
        startHeartbeat: () => {
            ++heartbeatStarts;
        },
        stopHeartbeat() {},
    });

    let releaseComplete;
    let markCompleteStarted;
    const completeStarted = new Promise((resolve) => {
        markCompleteStarted = resolve;
    });
    const completeGate = new Promise((resolve) => {
        releaseComplete = resolve;
    });
    const shutdown = createShutdownHandler({
        state,
        fastify,
        log,
        force: false,
        closeTimeout: 100,
        exitProcess: false,
        shutdownHooks: [async () => false],
        shutdownStartHooks: [],
        shutdownCompleteHooks: [],
        runHookWithTimeout: async (hook, args) => hook(...args),
        runLifecycleHooks: async (_hooks, _event, kind) => {
            if (kind === "onAutoShutdownComplete") {
                markCompleteStarted();
                await completeGate;
            }
        },
        schedule: () => {
            ++schedules;
        },
        cancel: () => {
            state.nextAt = null;
        },
        startHeartbeat: () => {
            ++heartbeatStarts;
        },
        stopHeartbeat() {},
    });

    const shutdownPromise = shutdown();
    await completeStarted;
    await hooks.get("preClose")();
    releaseComplete();
    await shutdownPromise;

    assert.strictEqual(state.closeRequested, true);
    assert.strictEqual(state.isShuttingDown, true);
    assert.strictEqual(heartbeatStarts, 0);
    assert.strictEqual(schedules, 0);
});

test("IPC disconnect failure does not change a closed shutdown into an error", async () => {
    const state = createState();
    state.nextAt = 1234;
    const outcomes = [];
    const exitCodes = [];
    const warnings = [];
    const originalExit = process.exit;
    const originalDisconnect = process.disconnect;
    const originalConnected = Object.getOwnPropertyDescriptor(process, "connected");
    process.exit = (code) => {
        exitCodes.push(code);
    };
    process.disconnect = () => {
        throw new Error("disconnect failed");
    };
    Object.defineProperty(process, "connected", { value: true, configurable: true });

    const shutdown = createShutdownHandler({
        state,
        fastify: { async close() {} },
        log: {
            debug() {},
            info() {},
            warn: (...args) => warnings.push(args),
            error() {},
        },
        force: false,
        closeTimeout: 100,
        exitProcess: true,
        shutdownHooks: [],
        shutdownStartHooks: [],
        shutdownCompleteHooks: [(event) => outcomes.push(event.outcome)],
        runHookWithTimeout: async (hook, args) => hook(...args),
        runLifecycleHooks: async (hooks, event) => {
            for (const hook of hooks) {
                await hook(event);
            }
        },
        schedule() {},
        cancel: () => {
            state.nextAt = null;
        },
        startHeartbeat() {},
        stopHeartbeat() {},
    });

    try {
        await shutdown("idle_timer");

        assert.deepStrictEqual(outcomes, ["closed"]);
        assert.deepStrictEqual(exitCodes, [0]);
        assert.ok(
            warnings.some((args) => args[1] === "Failed to disconnect idle worker IPC before exit"),
        );
    } finally {
        process.exit = originalExit;
        if (originalDisconnect === undefined) {
            delete process.disconnect;
        } else {
            process.disconnect = originalDisconnect;
        }
        if (originalConnected) {
            Object.defineProperty(process, "connected", originalConnected);
        } else {
            delete process.connected;
        }
    }
});
