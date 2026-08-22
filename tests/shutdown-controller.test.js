import assert from "node:assert/strict";
import { test } from "node:test";

import { createShutdownController } from "../src/shutdown-controller.js";

test("shutdown controller binds exactly one handler and preserves its promise", () => {
    const controller = createShutdownController();
    const expectedPromise = Promise.resolve();
    let observedTrigger = null;

    assert.throws(() => controller.run("manual"), /shutdown handler is not bound/);
    assert.throws(() => controller.bind(null), /shutdown handler must be a function/);

    const handler = (trigger) => {
        observedTrigger = trigger;
        return expectedPromise;
    };
    controller.bind(handler);

    assert.strictEqual(controller.run("manual"), expectedPromise);
    assert.strictEqual(observedTrigger, "manual");
    assert.throws(() => controller.bind(handler), /shutdown handler is already bound/);
});
