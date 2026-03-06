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

        log.warn({ pid: process.pid, nextAt: state.nextAt, trigger }, "Auto-shutdown: shutdown started");

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
