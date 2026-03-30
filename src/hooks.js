/**
 * Registers Fastify lifecycle hooks for request tracking, idle timer management,
 * grace period handling, and shutdown coordination.
 * @param {object} deps - Injected dependencies.
 * @param {FastifyInstance} deps.fastify - Fastify instance.
 * @param {object} deps.state - Shared mutable state.
 * @param {number} deps.grace - Grace period in seconds after startup before the timer arms.
 * @param {object} deps.log - Child logger instance.
 * @param {function(string): string} deps.normalizePath - Strips query strings from request paths.
 * @param {function(object, string): boolean} deps.shouldIgnoreRequest - Predicate for ignored requests.
 * @param {function(): void} deps.schedule - Arms the idle shutdown timer.
 * @param {function(): void} deps.cancel - Cancels the idle shutdown timer.
 * @param {function(): void} deps.startHeartbeat - Starts the heartbeat interval.
 * @param {function(): void} deps.stopHeartbeat - Stops the heartbeat interval.
 */
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

        ++state.inFlight;
        cancel();
    });

    fastify.addHook("onResponse", async (request, reply) => {
        if (request[state.ignoredSymbol]) {
            return;
        }
        if (state.inFlight <= 0) {
            log.warn(
                { inFlight: state.inFlight },
                "inFlight underflow detected; possible hook pairing mismatch",
            );
            state.inFlight = 0;
        } else {
            --state.inFlight;
        }
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
