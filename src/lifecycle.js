import { setTimeout as sleep } from "node:timers/promises";

/**
 * Creates hook execution utilities with timeout protection for shutdown lifecycle hooks.
 * @param {object} deps - Injected dependencies.
 * @param {number} deps.hookTimeout - Max milliseconds to wait for each hook before continuing.
 * @param {object} deps.log - Child logger instance.
 * @returns {{ runHookWithTimeout: function, runLifecycleHooks: function }}
 */
export function createLifecycle({ hookTimeout, log }) {
    const timeoutSentinel = Symbol("hook-timeout");

    async function runHookWithTimeout(hook, args, kind) {
        // Aborted in `finally` once the race settles; Promise.race keeps the
        // losing timer promise handled, so the abort rejection never leaks.
        const deadline = new AbortController();
        try {
            const result = await Promise.race([
                Promise.resolve(hook(...args)),
                sleep(hookTimeout, timeoutSentinel, { ref: false, signal: deadline.signal }),
            ]);
            if (result === timeoutSentinel) {
                log.error({ hook: hook.name || "anonymous", kind }, `${kind} hook timed out`);
                return timeoutSentinel;
            }
            return result;
        } catch (err) {
            log.error({ err }, `Error in ${kind} hook (ignored)`);
            return undefined;
        } finally {
            deadline.abort();
        }
    }

    async function runLifecycleHooks(list, event, kind, fastify) {
        for (const hook of list) {
            await runHookWithTimeout(hook, [event, fastify], kind);
        }
    }

    return {
        runHookWithTimeout,
        runLifecycleHooks,
    };
}
