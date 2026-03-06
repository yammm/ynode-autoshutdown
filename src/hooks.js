export function registerHooks({
    fastify,
    state,
    grace,
    log,
    normalizePath,
    shouldIgnoreRequest,
    schedule,
    cancel,
    startHeartbeat,
    stopHeartbeat,
}) {
    fastify.addHook("onRequest", async (request, reply) => {
        const path = normalizePath(request.routeOptions?.url || request.url);
        request[state.ignoredSymbol] = shouldIgnoreRequest(request, path);
        if (request[state.ignoredSymbol]) {
            return;
        }

        state.inFlight += 1;
        cancel();
    });

    fastify.addHook("onResponse", async (request, reply) => {
        if (request[state.ignoredSymbol]) {
            return;
        }
        state.inFlight = Math.max(0, state.inFlight - 1);
        if (state.inFlight === 0) {
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
        }, grace * 1000).unref();

        setTimeout(() => {
            startHeartbeat();
        }, grace * 1000).unref();
    });

    fastify.addHook("preClose", async () => {
        stopHeartbeat();
        state.isShuttingDown = true;
        cancel();
    });

    fastify.addHook("onClose", async () => {
        state.isShuttingDown = true;
        cancel();
    });
}
