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
});
