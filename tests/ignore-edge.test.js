import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

describe("Ignore URLs Edge Cases", () => {
    test("global and sticky RegExp patterns match deterministically", async () => {
        const globalPattern = /^\/health$/g;
        const stickyPattern = /^\/metrics$/y;
        const app = Fastify();

        app.get("/health", async () => "ok");
        app.get("/metrics", async () => "ok");
        await app.register(autoShutdown, {
            sleep: 60,
            grace: 0,
            jitter: 0,
            ignoreUrls: [globalPattern, stickyPattern],
        });
        await app.ready();

        app.autoshutdown.reset();
        const initialNextAt = app.autoshutdown.nextAt;
        for (const url of ["/health", "/health", "/metrics", "/metrics"]) {
            await app.inject({ method: "GET", url });
            assert.strictEqual(app.autoshutdown.nextAt, initialNextAt);
        }
        assert.strictEqual(globalPattern.lastIndex, 0);
        assert.strictEqual(stickyPattern.lastIndex, 0);

        await app.close();
    });

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

        await new Promise((resolve) => setTimeout(resolve, 2));
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
