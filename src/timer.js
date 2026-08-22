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

/**
 * Creates the idle shutdown timer controller with schedule/cancel operations.
 * @param {object} deps - Injected dependencies.
 * @param {object} deps.state - Shared mutable state (timer, graceTimer, nextAt, inFlight, activityLeases, hasListened, isShuttingDown).
 * @param {number} deps.delay - Base delay in milliseconds before shutdown fires.
 * @param {number} deps.jitter - Jitter in seconds added to delay to stagger herd exits.
 * @param {function(string): Promise<void>} deps.shutdown - Shutdown handler to invoke when timer expires.
 * @returns {{ schedule: function(): object|null, cancel: function(): void }}
 */
export function createTimerController({ state, delay, jitter, shutdown }) {
    function cancel() {
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        state.nextAt = null;
    }

    function schedule() {
        // Never arm before onListen: requests settled pre-listen (inject()
        // warmups, custom server factories) must not bypass the grace period.
        if (state.isShuttingDown || !state.hasListened || state.graceTimer) {
            return null;
        }

        cancel();
        if (state.inFlight > 0 || state.activityLeases.size > 0) {
            return null;
        }

        const jitterMs = jitter > 0 ? Math.floor(Math.random() * jitter * 1000) : 0;
        const ms = delay + jitterMs;
        state.nextAt = Date.now() + ms;
        state.timer = setTimeout(() => {
            void shutdown("idle_timer");
        }, ms);
        return state.timer;
    }

    return {
        schedule,
        cancel,
    };
}
