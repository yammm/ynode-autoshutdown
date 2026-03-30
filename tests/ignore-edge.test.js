import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

describe("Ignore URLs Edge Cases", () => {
    test("query strings and unmatched routes respect ignoreUrls", async () => {
        const app = Fastify();

        app.get("/health", async () => "ok");
        app.get("/active", async () => "ok");

        await app.register(autoShutdown, {
            sleep: 60,
            grace: 0,
            jitter: 0,
            ignoreUrls: ["/health", "/missing"],
        });

        await app.ready();

        app.autoshutdown.reset();
        const initialNextAt = app.autoshutdown.nextAt;
        assert.ok(typeof initialNextAt === "number");

        await app.inject({
            method: "GET",
            url: "/health?probe=1",
        });
        assert.strictEqual(
            app.autoshutdown.nextAt,
            initialNextAt,
            "matched ignored route with query should not touch timer",
        );

        await app.inject({
            method: "GET",
            url: "/missing?probe=1",
        });
        assert.strictEqual(
            app.autoshutdown.nextAt,
            initialNextAt,
            "unmatched ignored route with query should not touch timer",
        );

        await app.inject({
            method: "GET",
            url: "/active?probe=1",
        });
        assert.ok(
            app.autoshutdown.nextAt > initialNextAt,
            "non-ignored request should re-arm timer",
        );

        await app.close();
    });
});
