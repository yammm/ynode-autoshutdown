import assert from "node:assert/strict";
import { test } from "node:test";

import { createShutdownHandler } from "../src/shutdown.js";
import { createState } from "../src/state.js";

const log = { debug() {}, info() {}, warn() {}, error() {} };

function createHarness({ inFlight, activityLabels = [] }) {
    const state = createState();
    state.hasListened = true;
    state.inFlight = inFlight;
    for (const label of activityLabels) {
        state.activityLeases.set(Symbol(label), label);
    }

    let closeCalls = 0;
    let schedules = 0;
    const shutdown = createShutdownHandler({
        state,
        fastify: {
            async close() {
                ++closeCalls;
            },
        },
        log,
        force: false,
        closeTimeout: 100,
        exitProcess: false,
        shutdownHooks: [],
        shutdownStartHooks: [],
        shutdownCompleteHooks: [],
        runHookWithTimeout: async (hook, args) => hook(...args),
        runLifecycleHooks: async () => {},
        schedule: () => {
            ++schedules;
        },
        cancel() {},
        startHeartbeat() {},
        stopHeartbeat() {},
    });

    return {
        state,
        shutdown,
        get closeCalls() {
            return closeCalls;
        },
        get schedules() {
            return schedules;
        },
    };
}

test("idle trigger with in-flight requests stands down instead of closing", async () => {
    const harness = createHarness({ inFlight: 1 });

    await harness.shutdown("idle_timer");

    assert.strictEqual(harness.closeCalls, 0, "close must not run while requests are in flight");
    assert.strictEqual(harness.state.isShuttingDown, false, "state must remain re-armable");
    assert.strictEqual(harness.schedules, 1, "timer controller must be asked to re-arm");
});

test("non-idle triggers still shut down with requests in flight", async () => {
    const harness = createHarness({ inFlight: 1 });

    await harness.shutdown("memory_limit");

    assert.strictEqual(harness.closeCalls, 1, "memory-limit shutdown drains regardless of load");
    assert.strictEqual(harness.state.isShuttingDown, true);
});

test("idle trigger with no in-flight requests proceeds normally", async () => {
    const harness = createHarness({ inFlight: 0 });

    await harness.shutdown("idle_timer");

    assert.strictEqual(harness.closeCalls, 1);
    assert.strictEqual(harness.state.isShuttingDown, true);
});

test("idle trigger with an activity lease stands down instead of closing", async () => {
    const harness = createHarness({ inFlight: 0, activityLabels: ["queue-job"] });

    await harness.shutdown("idle_timer");

    assert.strictEqual(harness.closeCalls, 0, "close must not run while a lease is active");
    assert.strictEqual(harness.state.isShuttingDown, false, "state must remain re-armable");
    assert.strictEqual(harness.schedules, 1, "timer controller must be asked to re-arm");
});
