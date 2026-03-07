export function createLifecycle({ hookTimeout, log }) {
    const timeoutSentinel = Symbol("hook-timeout");

    async function runHookWithTimeout(hook, args, kind) {
        try {
            const hookPromise = Promise.resolve(hook(...args));
            const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve(timeoutSentinel), hookTimeout).unref(),
            );

            const result = await Promise.race([hookPromise, timeoutPromise]);
            if (result === timeoutSentinel) {
                log.error({ hook: hook.name || "anonymous", kind }, `${kind} hook timed out`);
                return timeoutSentinel;
            }
            return result;
        } catch (err) {
            log.error({ err }, `Error in ${kind} hook (ignored)`);
            return undefined;
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
