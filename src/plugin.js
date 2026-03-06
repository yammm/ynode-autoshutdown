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

/**
 *  Node.js Fastify plugin to Auto Shutdown after a period of inactivity
 *
 * @module @ynode/autoshutdown
 * @description A Fastify 5.x plugin to automatically shut down idle workers after a period of inactivity.
 *
 * The plugin arms an inactivity timer once the server is listening, cancels it while requests are in flight,
 * and re-arms it after the last response. When the timer expires, it runs any registered cleanup hooks and,
 * unless a hook vetoes shutdown by returning `false`, gracefully closes the Fastify instance.
 *
 * @example
 *   import Fastify from "fastify";
 *   import autoshutdown from "@ynode/autoshutdown";
 *
 *   const app = Fastify({ logger: true });
 *   await app.register(autoshutdown, {
 *     sleep: 10 * 60,           // seconds of inactivity
 *     grace: 5,                 // seconds after startup before timer activates
 *     ignoreUrls: ["/health"],  // paths that won't reset/affect the timer
 *     jitter: 5                 // optional seconds of random jitter to avoid herd exits
 *   });
 *
 *   // Optional: veto shutdown while some external condition holds
 *   app.onAutoShutdown(async () => {
 *     // veto by returning false
 *     if (someWSConnectionsOpen()) {
 *        return false;
 *     }
 *   });
 *
 *   await app.listen({ port: 3000 });
 *
 * @param {import("fastify").FastifyInstance} fastify The Fastify instance.
 * @param {object} [options] Plugin options.
 * @param {number} [options.sleep=1800] Inactivity time in seconds before shutdown.
 * @param {number} [options.grace=30] Grace period in seconds after startup before the timer is active.
 * @param {(string|RegExp)[]} [options.ignoreUrls=[]] URLs or route patterns to ignore for timer logic.
 * @param {number} [options.jitter=5] Optional jitter (seconds) added to the delay to reduce herd exits.
 * @param {boolean} [options.force=false] If true, attempt `server.closeAllConnections()` after close. ⚠️ Dangerous.
 *
 * @description `onAutoShutdown` hooks can return `false` to cancel the shutdown.
 */

async function autoShutdownPlugin(fastify, options = {}) {
    // Create a child logger
    const log = fastify.log.child({ name: "@ynode/autoshutdown" });

    // Prevent duplicate registration in the same encapsulation scope
    if (typeof fastify.hasDecorator === "function" && fastify.hasDecorator("autoshutdown")) {
        log.warn("@ynode/autoshutdown already registered in this scope; skipping.");
        return;
    }

    const defaults = {
        sleep: 30 * 60, // seconds
        grace: 30, // seconds
        ignoreUrls: [], // string | RegExp accepted (backwards-compatible)
        jitter: 5, // seconds (optional)
        force: false, // use closeAllConnections() after close (dangerous)
        reportLoad: false, // If true, sends heartbeat with Event Loop Lag
        heartbeatInterval: 2000, // ms
        hookTimeout: 5000, // ms
        memoryLimit: 0, // MB (0 = disabled)
    };
    const cfg = { ...defaults, ...options };
    const { sleep, grace, ignoreUrls, jitter, force, reportLoad, heartbeatInterval, hookTimeout, memoryLimit } = cfg;

    if (typeof sleep !== "number" || sleep <= 0) {
        throw new Error("@ynode/autoshutdown: `sleep` must be > 0");
    }
    if (typeof grace !== "number" || grace < 0) {
        throw new Error("@ynode/autoshutdown: `grace` must be >= 0");
    }
    if (typeof cfg.hookTimeout !== "number" || cfg.hookTimeout < 0) {
        throw new Error("@ynode/autoshutdown: `hookTimeout` must be >= 0");
    }
    if (typeof cfg.memoryLimit !== "number" || cfg.memoryLimit < 0) {
        throw new Error("@ynode/autoshutdown: `memoryLimit` must be >= 0");
    }
    if (typeof jitter !== "number" || jitter < 0) {
        throw new Error("@ynode/autoshutdown: `jitter` must be >= 0");
    }
    if (!Array.isArray(ignoreUrls)) {
        throw new Error("@ynode/autoshutdown: `ignoreUrls` must be an array");
    }

    // Heartbeat / Load Reporting
    let intervalTimer = null;

    function stopHeartbeat() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
    }

    function startHeartbeat() {
        if ((!reportLoad && memoryLimit === 0) || intervalTimer) {
            return;
        }

        let lastCheck = Date.now();
        intervalTimer = setInterval(() => {
            if (process.connected === false) {
                stopHeartbeat();
                return;
            }

            const now = Date.now();
            const lag = Math.max(0, now - lastCheck - heartbeatInterval);
            lastCheck = now;

            const mem = process.memoryUsage();

            // Check memory limit (MB) -> RSS matches standard container limits best
            if (memoryLimit > 0) {
                const rssMb = mem.rss / 1024 / 1024;
                if (rssMb > memoryLimit) {
                    log.warn({ rssMb, memoryLimit }, "Memory limit exceeded; shutting down");
                    void shutdown();
                    return;
                }
            }

            if (reportLoad && process.send) {
                process.send({ cmd: "heartbeat", lag, memory: mem });
            }
        }, heartbeatInterval);
    }

    // Ensure we clear interval on close
    fastify.addHook("preClose", async () => {
        stopHeartbeat();
    });

    const delay = sleep * 1000;
    let timer = null;
    let nextAt = null;
    let inFlight = 0;
    let isShuttingDown = false;

    const shutdownHooks = [];
    fastify.decorate("onAutoShutdown", (fn) => {
        if (typeof fn === "function") {
            shutdownHooks.push(fn);
        }
    });

    /**
     * Decorated control surface
     * - fastify.autoshutdown.reset(): arm/re-arm the idle timer now
     * - fastify.autoshutdown.cancel(): cancel the timer
     * - fastify.autoshutdown.inFlight: number of active, non-ignored requests
     * - fastify.autoshutdown.nextAt: epoch ms when the timer will fire (or null)
     * - fastify.autoshutdown.delay: configured base delay in ms
     */
    fastify.decorate("autoshutdown", {
        reset: schedule,
        cancel,
        get inFlight() {
            return inFlight;
        },
        get nextAt() {
            return nextAt;
        },
        get delay() {
            return delay;
        },
    });

    /**
     * Decide whether to ignore this path for timer logic.
     * Accepts exact strings or RegExp entries (NEW).
     * @private
     * @param {string} path
     * @param {(string|RegExp)[]} list
     * @returns {boolean}
     */
    function shouldIgnore(path, list) {
        if (!list?.length) {
            return false;
        }
        return list.some((p) =>
            typeof p === "string" ? p === path : p && typeof p.test === "function" && p.test(path),
        );
    }

    /**
     * Clears the existing shutdown timer.
     * @private
     */
    function cancel() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
            nextAt = null;
        }
    }

    /**
     * Resets/arms the inactivity timer. If it expires, it runs cleanup hooks and then shuts down the server.
     * @private
     */
    function schedule() {
        if (isShuttingDown) {
            return null;
        }

        cancel();
        if (inFlight > 0) {
            return null;
        }
        const jitterMs =
            jitter > 0 ? Math.floor(Math.random() * Math.min(jitter * 1000, delay / 3)) : 0;
        const ms = delay + jitterMs;
        nextAt = Date.now() + ms;
        timer = setTimeout(shutdown, ms);
        return timer;
    }

    /**
     * Shutdown sequence: run hooks (vetoable), then close gracefully,
     * then reap idle keep-alives, optionally drop all connections, and exit.
     * @private
     */
    async function shutdown() {
        if (isShuttingDown) {
            return;
        }

        isShuttingDown = true;
        cancel();
        stopHeartbeat();

        log.warn({ pid: process.pid, nextAt }, "Auto-shutdown: idle timer fired");
        // Run registered cleanup hooks (allow veto with `false`)
        for (const hook of shutdownHooks) {
            try {
                // Wrap hook in a timeout
                const hookPromise = Promise.resolve(hook(fastify));
                const timeoutPromise = new Promise((resolve) =>
                    setTimeout(() => resolve("TIMEOUT"), hookTimeout).unref()
                );

                const result = await Promise.race([hookPromise, timeoutPromise]);

                if (result === "TIMEOUT") {
                    log.error({ hook: hook.name || "anonymous" }, "onAutoShutdown hook timed out");
                    continue; // Proceed to shutdown if hook hangs
                }

                if (result === false) {
                    log.info("Shutdown cancelled by an onAutoShutdown hook; rescheduling");
                    isShuttingDown = false; // Reset the flag before rescheduling
                    return schedule();
                }
            } catch (err) {
                log.error({ err }, "Error in onAutoShutdown hook (ignored)");
            }
        }

        try {
            await fastify.close();

            // After close, reap keep-alives (Node >=18.2)
            try {
                fastify.server?.closeIdleConnections?.();
            } catch (err) {
                log.warn({ err }, "Error during closeIdleConnections:");
            }

            if (force) {
                try {
                    fastify.server?.closeAllConnections?.();
                } catch (err) {
                    log.warn({ err }, "Error during closeAllConnections");
                }
            }

            process.exit(0);
        } catch (err) {
            log.error({ err }, "Error during fastify.close()");
            process.exit(1);
        }
    }

    // Hooks (promise style)
    fastify.addHook("onRequest", async (request, reply) => {
        const path = request.routeOptions?.url || request.url; // route pattern if available
        if (shouldIgnore(path, ignoreUrls)) {
            return;
        }

        // do not allow shutdown while handling a request
        ++inFlight;
        cancel();
    });

    fastify.addHook("onResponse", async (request, reply) => {
        const path = request.routeOptions?.url || request.url;
        if (shouldIgnore(path, ignoreUrls)) {
            return;
        }
        inFlight = Math.max(0, inFlight - 1);
        if (inFlight === 0) {
            schedule();
        }
    });

    fastify.addHook("onListen", async () => {
        if (grace > 0) {
            log.debug(`Worker ${process.pid} in grace period (${grace}s)`);
        }
        setTimeout(() => {
            if (grace > 0) {
                log.debug(`Grace ended for worker ${process.pid}; arming inactivity timer`);
            }
            schedule();
        }, grace * 1000).unref(); // if grace === 0 schedule on next tick

        // Start heartbeat after grace period (if configured)
        setTimeout(() => {
            startHeartbeat();
        }, grace * 1000).unref();
    });

    fastify.addHook("preClose", async () => {
        isShuttingDown = true;
        cancel();
    });

    fastify.addHook("onClose", async () => {
        isShuttingDown = true;
        cancel();
    });
}

export default fp(autoShutdownPlugin, {
    fastify: "5.x",
    name: "@ynode/autoshutdown",
});
