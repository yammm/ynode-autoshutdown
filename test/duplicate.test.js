import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

describe("Duplicate Registration", () => {
    test("second registration in same scope is ignored", async () => {
        const app = Fastify();

        await app.register(autoShutdown, {
            sleep: 33,
            grace: 0,
            jitter: 0,
        });

        await app.register(autoShutdown, {
            sleep: 1,
            grace: 0,
            jitter: 0,
        });

        await app.ready();

        assert.strictEqual(app.autoshutdown.delay, 33000, "first registration should remain active");
        assert.strictEqual(typeof app.onAutoShutdown, "function");

        await app.close();
    });
});
