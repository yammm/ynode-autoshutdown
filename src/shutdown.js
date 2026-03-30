/**
 * Creates the shutdown sequence handler that orchestrates graceful close,
 * lifecycle hook execution, veto logic, and optional process exit.
 * @param {object} deps - Injected dependencies.
 * @param {object} deps.state - Shared mutable state.
 * @param {FastifyInstance} deps.fastify - Fastify instance to close.
 * @param {object} deps.log - Child logger instance.
 * @param {boolean} deps.force - Whether to force-close all connections after fastify.close().
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
        cancel();
        stopHeartbeat();

        const startedAt = Date.now();
        const startEvent = {
            trigger,
            pid: process.pid,
            inFlight: state.inFlight,
            nextAt: state.nextAt,
            startedAt,
        };
        await runLifecycleHooks(shutdownStartHooks, startEvent, "onAutoShutdownStart", fastify);

        log.warn(
            { pid: process.pid, nextAt: state.nextAt, trigger },
            "Auto-shutdown: shutdown started",
        );

        for (const hook of shutdownHooks) {
            const result = await runHookWithTimeout(hook, [fastify], "onAutoShutdown");
            if (result === false) {
                log.info("Shutdown cancelled by an onAutoShutdown hook; rescheduling");
                state.isShuttingDown = false;
                startHeartbeat();
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
                return schedule();
            }
        }

        try {
            await fastify.close();

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
                if (typeof process.disconnect === "function" && process.connected) {
                    process.disconnect();
                }
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
                if (typeof process.disconnect === "function" && process.connected) {
                    process.disconnect();
                }
                process.exit(1);
            }
        }
    };
}
