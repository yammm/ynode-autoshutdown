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
