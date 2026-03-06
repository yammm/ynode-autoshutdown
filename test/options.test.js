import { describe, test } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import autoShutdown from "../src/plugin.js";

describe("Option Validation", () => {
    test("rejects heartbeatInterval <= 0", async () => {
        const app = Fastify();
        try {
            app.register(autoShutdown, {
                heartbeatInterval: 0,
            });
            await assert.rejects(
                app.ready(),
                /`heartbeatInterval` must be > 0/,
            );
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
            await assert.rejects(
                app.ready(),
                /`hookTimeout` must be >= 0/,
            );
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
            await assert.rejects(
                app.ready(),
                /`memoryLimit` must be >= 0/,
            );
        } finally {
            await app.close();
        }
    });
});
