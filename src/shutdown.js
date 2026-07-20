import cluster from "node:cluster";

const CLOSE_TIMEOUT_CODE = "AUTOSHUTDOWN_CLOSE_TIMEOUT";

function createCloseTimeoutError(closeTimeout, phase) {
    const error = new Error(
        `Fastify close ${phase} exceeded the configured ${closeTimeout}ms timeout`,
    );
    error.code = CLOSE_TIMEOUT_CODE;
    return error;
}

async function waitForClose(closePromise, closeTimeout, phase) {
    let timeout = null;
    try {
        await Promise.race([
            closePromise,
            new Promise((_, reject) => {
                timeout = setTimeout(
                    () => reject(createCloseTimeoutError(closeTimeout, phase)),
                    closeTimeout,
                );
            }),
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

function closeIdleConnections(fastify, log) {
    try {
        fastify.server?.closeIdleConnections?.();
    } catch (err) {
        log.warn({ err }, "Error during closeIdleConnections");
    }
}

async function closeFastify({ fastify, log, force, closeTimeout }) {
    const closePromise = Promise.resolve().then(() => fastify.close());

    try {
        await waitForClose(closePromise, closeTimeout, "grace period");
    } catch (err) {
        if (err?.code !== CLOSE_TIMEOUT_CODE || !force) {
            throw err;
        }

        log.warn({ closeTimeout }, "Fastify close timed out; force-closing active connections");
        closeIdleConnections(fastify, log);
        try {
            fastify.server?.closeAllConnections?.();
        } catch (closeErr) {
            log.warn({ err: closeErr }, "Error during closeAllConnections");
        }
        await waitForClose(closePromise, closeTimeout, "force-close period");
    }

    closeIdleConnections(fastify, log);
}

function disconnectForIdleExit(trigger) {
    if (trigger !== "idle_timer") {
        return;
    }

    if (cluster.isWorker && cluster.worker) {
        if (typeof cluster.worker.isConnected !== "function" || cluster.worker.isConnected()) {
            cluster.worker.disconnect();
        }
        return;
    }

    if (typeof process.disconnect === "function" && process.connected) {
        process.disconnect();
    }
}

/**
 * Creates the shutdown sequence handler that orchestrates graceful close,
 * lifecycle hook execution, veto logic, and optional process exit.
 * @param {object} deps - Injected dependencies.
 * @param {object} deps.state - Shared mutable state.
 * @param {FastifyInstance} deps.fastify - Fastify instance to close.
 * @param {object} deps.log - Child logger instance.
 * @param {boolean} deps.force - Whether to force-close connections after a close timeout.
 * @param {number} deps.closeTimeout - Maximum milliseconds for graceful and forced close phases.
 * @param {boolean} deps.exitProcess - Whether to call process.exit() after shutdown.
 * @param {function[]} deps.shutdownHooks - Veto hooks; returning false cancels shutdown.
 * @param {function[]} deps.shutdownStartHooks - Lifecycle hooks fired when shutdown begins.
 * @param {function[]} deps.shutdownCompleteHooks - Lifecycle hooks fired when shutdown ends.
 * @param {function} deps.runHookWithTimeout - Executes a hook with timeout protection.
 * @param {function} deps.runLifecycleHooks - Executes an array of lifecycle hooks sequentially.
 * @param {function} deps.schedule - Re-arms the idle timer (used after veto).
 * @param {function} deps.cancel - Cancels the idle timer.
 * @param {function} deps.startHeartbeat - Restarts heartbeat (used after veto).
 * @param {function} deps.stopHeartbeat - Stops the heartbeat interval.
 * @returns {function(string=): Promise<void>} The shutdown function, accepting an optional trigger string.
 */
export function createShutdownHandler({
    state,
    fastify,
    log,
    force,
    closeTimeout,
    exitProcess,
    shutdownHooks,
    shutdownStartHooks,
    shutdownCompleteHooks,
    runHookWithTimeout,
    runLifecycleHooks,
    schedule,
    cancel,
    startHeartbeat,
    stopHeartbeat,
}) {
    return async function shutdown(trigger = "idle_timer") {
        if (state.isShuttingDown) {
            return;
        }

        state.isShuttingDown = true;
        const nextAt = state.nextAt;
        cancel();
        stopHeartbeat();

        const startedAt = Date.now();
        const startEvent = {
            trigger,
            pid: process.pid,
            inFlight: state.inFlight,
            nextAt,
            startedAt,
        };
        await runLifecycleHooks(shutdownStartHooks, startEvent, "onAutoShutdownStart", fastify);

        log.warn({ pid: process.pid, nextAt, trigger }, "Auto-shutdown: shutdown started");

        for (const hook of shutdownHooks) {
            const result = await runHookWithTimeout(hook, [fastify], "onAutoShutdown");
            if (result === false) {
                log.info("Shutdown cancelled by an onAutoShutdown hook; rescheduling");
                // Run complete hooks BEFORE re-arming the heartbeat. The
                // heartbeat can trigger a fresh shutdown (memory_limit) the
                // moment it ticks, and we must guarantee that the "vetoed"
                // complete event for this shutdown fires before any new
                // shutdownStart event is emitted. Keeping isShuttingDown
                // true across the await blocks both heartbeat-driven and
                // signal-driven re-entry (see shutdown.js:38, heartbeat.js:34).
                await runLifecycleHooks(
                    shutdownCompleteHooks,
                    {
                        ...startEvent,
                        completedAt: Date.now(),
                        durationMs: Date.now() - startedAt,
                        outcome: "vetoed",
                    },
                    "onAutoShutdownComplete",
                    fastify,
                );
                state.isShuttingDown = false;
                startHeartbeat();
                schedule();
                return;
            }
        }

        try {
            await closeFastify({ fastify, log, force, closeTimeout });

            await runLifecycleHooks(
                shutdownCompleteHooks,
                {
                    ...startEvent,
                    completedAt: Date.now(),
                    durationMs: Date.now() - startedAt,
                    outcome: "closed",
                },
                "onAutoShutdownComplete",
                fastify,
            );

            if (exitProcess) {
                disconnectForIdleExit(trigger);
                process.exit(0);
            }
        } catch (err) {
            log.error({ err }, "Error during fastify.close()");

            await runLifecycleHooks(
                shutdownCompleteHooks,
                {
                    ...startEvent,
                    completedAt: Date.now(),
                    durationMs: Date.now() - startedAt,
                    outcome: "error",
                    error: err,
                },
                "onAutoShutdownComplete",
                fastify,
            );

            if (exitProcess) {
                process.exit(1);
            }
        }
    };
}
