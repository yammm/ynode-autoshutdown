import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";

import { createActivityController } from "../src/activity.js";
import autoShutdown from "../src/plugin.js";
import { createState } from "../src/state.js";

function createHarness() {
    const state = createState();
    state.hasListened = true;
    let cancelCalls = 0;
    let scheduleCalls = 0;
    const activity = createActivityController({
        state,
        cancel: () => {
            ++cancelCalls;
        },
        schedule: () => {
            ++scheduleCalls;
        },
    });
    return {
        activity,
        state,
        get cancelCalls() {
            return cancelCalls;
        },
        get scheduleCalls() {
            return scheduleCalls;
        },
    };
}

test("overlapping activity leases cancel once per acquire and re-arm after final release", () => {
    const harness = createHarness();
    const releaseFirst = harness.activity.acquire("first");
    const releaseSecond = harness.activity.acquire("second");

    assert.strictEqual(harness.cancelCalls, 2);
    assert.strictEqual(harness.state.activityLeases.size, 2);

    releaseFirst();
    releaseFirst();
    assert.strictEqual(harness.state.activityLeases.size, 1);
    assert.strictEqual(harness.scheduleCalls, 0);

    releaseSecond();
    releaseSecond();
    assert.strictEqual(harness.state.activityLeases.size, 0);
    assert.strictEqual(harness.scheduleCalls, 1);
});

test("track preserves fulfillment and rejection while always releasing its lease", async () => {
    const fulfilled = createHarness();
    assert.strictEqual(await fulfilled.activity.track(Promise.resolve(42), "fulfilled"), 42);
    assert.strictEqual(fulfilled.state.activityLeases.size, 0);
    assert.strictEqual(fulfilled.scheduleCalls, 1);

    const rejected = createHarness();
    const error = new Error("tracked failure");
    await assert.rejects(rejected.activity.track(Promise.reject(error), "rejected"), error);
    assert.strictEqual(rejected.state.activityLeases.size, 0);
    assert.strictEqual(rejected.scheduleCalls, 1);
});

test("activity API validates promises and labels deterministically", () => {
    const harness = createHarness();

    assert.throws(
        () => harness.activity.acquire("   "),
        /activity label must be a non-empty string/,
    );
    assert.throws(() => harness.activity.acquire(42), /activity label must be a non-empty string/);
    assert.throws(() => harness.activity.track(null), /`track` requires a promise-like value/);
    assert.throws(() => harness.activity.track({}), /`track` requires a promise-like value/);
    assert.strictEqual(harness.state.activityLeases.size, 0);
});

test("public activity API rejects acquisition after Fastify shutdown starts", async () => {
    const app = Fastify();
    await app.register(autoShutdown, { sleep: 60, grace: 0, jitter: 0, exitProcess: false });
    await app.ready();
    await app.close();

    assert.throws(() => app.autoshutdown.acquire("too-late"), /after shutdown starts/);
});
