import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("requests settled before listen do not bypass the startup grace period", async () => {
    const app = Fastify();
    app.get("/warmup", async () => ({ ok: true }));

    let closeCalled = false;
    app.addHook("onClose", async () => {
        closeCalled = true;
    });

    await app.register(autoShutdown, {
        sleep: 0.05,
        grace: 0.5,
        jitter: 0,
        exitProcess: false,
    });
    await app.ready();

    try {
        const res = await app.inject({ method: "GET", url: "/warmup" });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(
            app.autoshutdown.nextAt,
            null,
            "settling a pre-listen request must not arm the idle timer",
        );

        // Well past `sleep`; without the listen gate this would have shut down.
        await sleep(150);
        assert.strictEqual(app.autoshutdown.nextAt, null);
        assert.strictEqual(closeCalled, false, "no shutdown may occur before listen");

        await app.listen({ port: 0, host: "127.0.0.1" });
        await sleep(150);
        assert.strictEqual(closeCalled, false, "grace period still applies after listen");
    } finally {
        await app.close();
    }
});
