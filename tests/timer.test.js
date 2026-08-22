import assert from "node:assert/strict";
import { test } from "node:test";

import { createTimerController } from "../src/timer.js";

test("configured jitter is not silently capped by the base delay", () => {
    const originalRandom = Math.random;
    const state = {
        timer: null,
        nextAt: null,
        inFlight: 0,
        activityLeases: new Map(),
        hasListened: true,
        isShuttingDown: false,
    };
    Math.random = () => 0.75;
    try {
        const timer = createTimerController({
            state,
            delay: 1000,
            jitter: 2,
            shutdown: async () => {},
        });
        const startedAt = Date.now();
        timer.schedule();

        assert.ok(state.nextAt - startedAt >= 2490);
        assert.ok(state.nextAt - startedAt <= 2510);
        timer.cancel();
    } finally {
        Math.random = originalRandom;
        if (state.timer) {
            clearTimeout(state.timer);
        }
    }
});

test("active activity leases keep the idle timer disarmed", () => {
    const token = Symbol("job");
    const state = {
        timer: null,
        graceTimer: null,
        nextAt: null,
        inFlight: 0,
        activityLeases: new Map([[token, "job"]]),
        hasListened: true,
        isShuttingDown: false,
    };
    const timer = createTimerController({
        state,
        delay: 1000,
        jitter: 0,
        shutdown: async () => {},
    });

    assert.strictEqual(timer.schedule(), null);
    assert.strictEqual(state.nextAt, null);
});
