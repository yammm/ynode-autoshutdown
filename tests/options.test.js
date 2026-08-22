import assert from "node:assert";
import { describe, test } from "node:test";

import Fastify from "fastify";

import autoShutdown from "../src/plugin.js";

describe("Option Validation", () => {
    test("rejects heartbeatInterval <= 0", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                heartbeatInterval: 0,
            });
            await assert.rejects(app.ready(), /`heartbeatInterval` must be > 0/);
        } finally {
            await app.close();
        }
    });

    test("rejects negative hookTimeout", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                hookTimeout: -1,
            });
            await assert.rejects(app.ready(), /`hookTimeout` must be >= 0/);
        } finally {
            await app.close();
        }
    });

    test("rejects negative memoryLimit", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                memoryLimit: -1,
            });
            await assert.rejects(app.ready(), /`memoryLimit` must be >= 0/);
        } finally {
            await app.close();
        }
    });

    test("rejects non-function ignore matcher", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                ignore: "not-a-function",
            });
            await assert.rejects(app.ready(), /`ignore` must be a function/);
        } finally {
            await app.close();
        }
    });

    test("rejects non-boolean exitProcess", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                exitProcess: 1,
            });
            await assert.rejects(app.ready(), /`exitProcess` must be a boolean/);
        } finally {
            await app.close();
        }
    });

    test("rejects timers that exceed Node.js limits", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                sleep: 2_147_483,
                jitter: 1,
            });
            await assert.rejects(app.ready(), /`sleep \+ jitter` exceeds Node\.js timer limits/);
        } finally {
            await app.close();
        }
    });

    test("rejects invalid ownership and lifecycle option types", async (t) => {
        for (const [name, value, pattern] of [
            ["force", "yes", /`force` must be a boolean/],
            ["reportLoad", 1, /`reportLoad` must be a boolean/],
            ["closeTimeout", 0, /`closeTimeout` must be > 0/],
            ["onShutdownStart", true, /`onShutdownStart` must be a function/],
            ["onShutdownCommit", "yes", /`onShutdownCommit` must be a function/],
            ["onShutdownComplete", {}, /`onShutdownComplete` must be a function/],
        ]) {
            await t.test(name, async () => {
                const app = Fastify();
                try {
                    app.register(autoShutdown, { [name]: value });
                    await assert.rejects(app.ready(), pattern);
                } finally {
                    await app.close();
                }
            });
        }
    });

    test("rejects invalid ignoreUrls entries", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, { ignoreUrls: ["/health", { test: () => true }] });
            await assert.rejects(app.ready(), /entries must be strings or RegExp objects/);
        } finally {
            await app.close();
        }
    });

    test("rejects unknown option keys with a TypeError naming them", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, { slep: 600, constructor: true });
            await assert.rejects(app.ready(), (err) => {
                assert.ok(err instanceof TypeError);
                assert.match(err.message, /unknown option\(s\): slep, constructor/);
                return true;
            });
        } finally {
            await app.close();
        }
    });

    test("undefined option values retain their defaults", async () => {
        const app = Fastify();
        try {
            await app.register(autoShutdown, {
                force: undefined,
                reportLoad: undefined,
                closeTimeout: undefined,
                onShutdownStart: undefined,
            });
            await app.ready();
            assert.strictEqual(app.autoshutdown.delay, 30 * 60 * 1000);
        } finally {
            await app.close();
        }
    });
});
