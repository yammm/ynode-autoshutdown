// ynode/autoshutdown

/*
The MIT License (MIT)

Copyright (c) 2026 Michael Welter <me@mikinho.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import fp from "fastify-plugin";

import { createConfig, validateConfig } from "./config.js";
import { createHeartbeatController } from "./heartbeat.js";
import { registerHooks } from "./hooks.js";
import { normalizePath, shouldIgnoreRequest as shouldIgnoreRequestMatcher } from "./ignore.js";
import { createLifecycle } from "./lifecycle.js";
import { createShutdownHandler } from "./shutdown.js";
import { createState } from "./state.js";
import { createTimerController } from "./timer.js";

/**
 *  Node.js Fastify plugin to Auto Shutdown after a period of inactivity
 *
 * @module @ynode/autoshutdown
 * @description A Fastify 5.x plugin to automatically shut down idle workers after a period of inactivity.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} [options] Plugin options.
 * @param {number} [options.sleep=1800] Inactivity time in seconds before shutdown.
 * @param {number} [options.grace=30] Grace period in seconds after startup before the timer is active.
 * @param {Array<string|RegExp>} [options.ignoreUrls=[]] URLs or route patterns to ignore for timer logic.
 * @param {function(FastifyRequest, string): boolean} [options.ignore] Optional request matcher to ignore timer logic.
 * @param {number} [options.jitter=5] Optional jitter (seconds) added to the delay to reduce herd exits.
 * @param {boolean} [options.force=false] If true, attempt `server.closeAllConnections()` after close. ⚠️ Dangerous.
 * @param {boolean} [options.exitProcess=true] If false, closes Fastify but does not call `process.exit`.
 * @param {boolean} [options.reportLoad=false] If true, send IPC heartbeat messages.
 * @param {number} [options.heartbeatInterval=2000] Heartbeat interval in milliseconds (> 0).
 * @param {number} [options.hookTimeout=5000] Max milliseconds to wait for each shutdown hook (>= 0).
 * @param {number} [options.memoryLimit=0] RSS threshold in MB that triggers shutdown (>= 0, 0 disables).
 * @param {function(object, FastifyInstance): (void|Promise<void>)} [options.onShutdownStart] Optional lifecycle hook called when shutdown starts.
 * @param {function(object, FastifyInstance): (void|Promise<void>)} [options.onShutdownComplete] Optional lifecycle hook called when shutdown completes/cancels/fails.
 */
async function autoShutdownPlugin(fastify, options = {}) {
    const log = fastify.log.child({ name: "@ynode/autoshutdown" });

    if (typeof fastify.hasDecorator === "function" && fastify.hasDecorator("autoshutdown")) {
        throw new Error("@ynode/autoshutdown has already been registered");
    }

    const cfg = createConfig(options);
    validateConfig(cfg);

    const state = createState();
    const delay = cfg.sleep * 1000;

    const shutdownHooks = [];
    const shutdownStartHooks = [];
    const shutdownCompleteHooks = [];

    if (typeof cfg.onShutdownStart === "function") {
        shutdownStartHooks.push(cfg.onShutdownStart);
    }
    if (typeof cfg.onShutdownComplete === "function") {
        shutdownCompleteHooks.push(cfg.onShutdownComplete);
    }

    fastify.decorate("onAutoShutdown", (fn) => {
        if (typeof fn === "function") {
            shutdownHooks.push(fn);
        }
    });

    fastify.decorate("onAutoShutdownStart", (fn) => {
        if (typeof fn === "function") {
            shutdownStartHooks.push(fn);
        }
    });

    fastify.decorate("onAutoShutdownComplete", (fn) => {
        if (typeof fn === "function") {
            shutdownCompleteHooks.push(fn);
        }
    });

    const lifecycle = createLifecycle({
        hookTimeout: cfg.hookTimeout,
        log,
    });

    let shutdown = async () => {};

    const timer = createTimerController({
        state,
        delay,
        jitter: cfg.jitter,
        shutdown: async (trigger) => shutdown(trigger),
    });

    const heartbeat = createHeartbeatController({
        state,
        reportLoad: cfg.reportLoad,
        memoryLimit: cfg.memoryLimit,
        heartbeatInterval: cfg.heartbeatInterval,
        log,
        shutdown: async (trigger) => shutdown(trigger),
    });

    shutdown = createShutdownHandler({
        state,
        fastify,
        log,
        force: cfg.force,
        exitProcess: cfg.exitProcess,
        shutdownHooks,
        shutdownStartHooks,
        shutdownCompleteHooks,
        runHookWithTimeout: lifecycle.runHookWithTimeout,
        runLifecycleHooks: lifecycle.runLifecycleHooks,
        schedule: timer.schedule,
        cancel: timer.cancel,
        startHeartbeat: heartbeat.startHeartbeat,
        stopHeartbeat: heartbeat.stopHeartbeat,
    });

    fastify.decorate("autoshutdown", {
        reset: timer.schedule,
        cancel: timer.cancel,
        get inFlight() {
            return state.inFlight;
        },
        get nextAt() {
            return state.nextAt;
        },
        get delay() {
            return delay;
        },
    });

    registerHooks({
        fastify,
        state,
        grace: cfg.grace,
        log,
        normalizePath,
        shouldIgnoreRequest: (request, path) =>
            shouldIgnoreRequestMatcher({
                request,
                path,
                ignoreUrls: cfg.ignoreUrls,
                ignore: cfg.ignore,
                log,
            }),
        schedule: timer.schedule,
        cancel: timer.cancel,
        startHeartbeat: heartbeat.startHeartbeat,
        stopHeartbeat: heartbeat.stopHeartbeat,
    });
}

export default fp(autoShutdownPlugin, {
    fastify: "5.x",
    name: "@ynode/autoshutdown",
});
