import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

async function createApp({ startEvents, completeEvents, setup = null }) {
    const app = Fastify();
    setup?.(app);
    await app.register(autoShutdown, {
        sleep: 60,
        grace: 0,
        jitter: 0,
        exitProcess: false,
        onShutdownStart: (event) => {
            startEvents.push(event);
        },
        onShutdownComplete: (event) => {
            completeEvents.push(event);
        },
    });
    await app.ready();
    return app;
}

test("shutdown(trigger) drains with a custom trigger name", async () => {
    const startEvents = [];
    const completeEvents = [];
    let closeCalled = false;
    const app = await createApp({
        startEvents,
        completeEvents,
        setup: (instance) => {
            instance.addHook("onClose", async () => {
                closeCalled = true;
            });
        },
    });

    await app.autoshutdown.shutdown("drain");

    assert.strictEqual(closeCalled, true, "shutdown must close the Fastify instance");
    assert.strictEqual(startEvents.length, 1);
    assert.strictEqual(startEvents[0].trigger, "drain");
    assert.strictEqual(completeEvents[0].outcome, "closed");
});

test("shutdown() defaults to the manual trigger", async () => {
    const startEvents = [];
    const completeEvents = [];
    const app = await createApp({ startEvents, completeEvents });

    await app.autoshutdown.shutdown();

    assert.strictEqual(startEvents[0].trigger, "manual");
});

test("shutdown(trigger) rejects invalid trigger names", async () => {
    const startEvents = [];
    const completeEvents = [];
    const app = await createApp({ startEvents, completeEvents });

    try {
        for (const bad of ["", "   ", 42, null, {}]) {
            await assert.rejects(
                () => app.autoshutdown.shutdown(bad),
                (err) => {
                    assert.ok(err instanceof TypeError);
                    assert.match(err.message, /`trigger` must be a non-empty string/);
                    return true;
                },
            );
        }
        assert.strictEqual(startEvents.length, 0, "no shutdown may start on invalid input");
    } finally {
        await app.close();
    }
});

test("concurrent shutdown(trigger) calls join the active shutdown attempt", async () => {
    const startEvents = [];
    const completeEvents = [];
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const app = await createApp({
        startEvents,
        completeEvents,
        setup: (instance) => {
            instance.addHook("onClose", async () => {
                await gate;
            });
        },
    });

    const first = app.autoshutdown.shutdown("drain");
    const second = app.autoshutdown.shutdown("drain-again");

    let secondSettled = false;
    void second.then(() => {
        secondSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(secondSettled, false, "re-entry must wait for the active close");

    release();
    await Promise.all([first, second]);

    assert.strictEqual(startEvents.length, 1, "re-entry must not start a second shutdown");
    assert.strictEqual(startEvents[0].trigger, "drain");
});

test("shutdown commit observers run only after every veto hook accepts", async () => {
    const startEvents = [];
    const completeEvents = [];
    const commitEvents = [];
    const vetoedApp = await createApp({ startEvents, completeEvents });
    vetoedApp.onAutoShutdown(() => false);
    vetoedApp.onAutoShutdownCommit((event) => commitEvents.push(event));

    await vetoedApp.autoshutdown.shutdown("veto-check");

    assert.strictEqual(commitEvents.length, 0, "a vetoed attempt must never commit");
    assert.strictEqual(completeEvents[0].outcome, "vetoed");
    await vetoedApp.close();

    const acceptedStarts = [];
    const acceptedCompletions = [];
    const acceptedCommits = [];
    const acceptedApp = await createApp({
        startEvents: acceptedStarts,
        completeEvents: acceptedCompletions,
    });
    acceptedApp.onAutoShutdown(() => true);
    acceptedApp.onAutoShutdownCommit((event) => acceptedCommits.push(event));

    await acceptedApp.autoshutdown.shutdown("commit-check");

    assert.strictEqual(acceptedCommits.length, 1);
    assert.strictEqual(acceptedCommits[0].trigger, "commit-check");
    assert.ok(acceptedCommits[0].committedAt >= acceptedCommits[0].startedAt);
    assert.strictEqual(acceptedCompletions[0].outcome, "closed");
});
