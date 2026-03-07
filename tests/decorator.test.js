import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Decorated Control Surface", () => {
    test("exposes reset/cancel/inFlight/nextAt/delay behavior", async () => {
        const app = Fastify();

        app.get("/slow", async () => {
            await sleep(80);
            return "ok";
        });

        await app.register(autoShutdown, {
            sleep: 60,
            grace: 0,
            jitter: 0,
        });

        await app.ready();

        assert.ok(app.autoshutdown, "autoshutdown decorator should exist");
        assert.strictEqual(app.autoshutdown.delay, 60000);
        assert.strictEqual(app.autoshutdown.nextAt, null);
        assert.strictEqual(app.autoshutdown.inFlight, 0);

        app.autoshutdown.reset();
        const firstNextAt = app.autoshutdown.nextAt;
        assert.ok(typeof firstNextAt === "number");
        assert.ok(firstNextAt > Date.now(), "nextAt should be in the future");

        app.autoshutdown.cancel();
        assert.strictEqual(app.autoshutdown.nextAt, null);

        const reqPromise = app.inject({
            method: "GET",
            url: "/slow",
        });

        await sleep(10);
        assert.strictEqual(app.autoshutdown.inFlight, 1, "inFlight should increment while request runs");

        await reqPromise;
        assert.strictEqual(app.autoshutdown.inFlight, 0, "inFlight should return to zero after response");
        assert.ok(typeof app.autoshutdown.nextAt === "number", "timer should be re-armed after response");

        await app.close();
    });
});
