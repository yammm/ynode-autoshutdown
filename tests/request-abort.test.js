import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("aborted requests settle in-flight accounting and re-arm the idle timer", async () => {
    const app = Fastify();
    let markStarted;
    const started = new Promise((resolve) => {
        markStarted = resolve;
    });

    app.get("/slow", async () => {
        markStarted();
        await sleep(75);
        return { ok: true };
    });
    await app.register(autoShutdown, {
        sleep: 60,
        grace: 0,
        jitter: 0,
        exitProcess: false,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const { port } = app.server.address();
    const request = http.get({ host: "127.0.0.1", port, path: "/slow" });
    request.on("error", () => {});
    await started;
    assert.strictEqual(app.autoshutdown.inFlight, 1);

    request.destroy();
    await sleep(125);

    assert.strictEqual(app.autoshutdown.inFlight, 0);
    assert.strictEqual(typeof app.autoshutdown.nextAt, "number");
    await app.close();
});
