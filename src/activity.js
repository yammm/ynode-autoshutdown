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
 * Validates and normalizes an optional activity label.
 * @param {*} label - User-provided activity label.
 * @returns {string|null} Trimmed label, or null for an unlabeled lease.
 * @throws {TypeError} If the label is not a non-empty string.
 */
function normalizeLabel(label) {
    if (label === undefined) {
        return null;
    }
    if (typeof label !== "string" || label.trim() === "") {
        throw new TypeError("@ynode/autoshutdown: activity label must be a non-empty string");
    }
    return label.trim();
}

/**
 * Creates the controller for non-request activity leases.
 * @param {object} deps - Injected dependencies.
 * @param {object} deps.state - Shared mutable plugin state.
 * @param {function(): void} deps.schedule - Arms the idle timer when lifecycle state permits.
 * @param {function(): void} deps.cancel - Cancels the active idle timer.
 * @returns {{ acquire: function(string=): function(): void, track: function(PromiseLike<*>, string=): Promise<*> }}
 */
export function createActivityController({ state, schedule, cancel }) {
    /**
     * Acquires an activity lease and returns an idempotent release function.
     * @param {string} [label] - Optional diagnostic label.
     * @returns {function(): void} Idempotent release function.
     * @throws {Error} If shutdown has already started.
     */
    function acquire(label) {
        const normalizedLabel = normalizeLabel(label);
        if (state.isShuttingDown || state.closeRequested) {
            throw new Error("@ynode/autoshutdown: cannot acquire activity after shutdown starts");
        }

        const token = Symbol(normalizedLabel ?? "activity");
        state.activityLeases.set(token, normalizedLabel);
        cancel();

        let released = false;
        return function release() {
            if (released) {
                return;
            }
            released = true;
            state.activityLeases.delete(token);
            if (state.activityLeases.size === 0) {
                schedule();
            }
        };
    }

    /**
     * Holds an activity lease until a promise-like value settles.
     * @param {PromiseLike<*>} promise - Promise-like work to track.
     * @param {string} [label] - Optional diagnostic label.
     * @returns {Promise<*>} Promise preserving the tracked work's fulfillment or rejection.
     * @throws {TypeError} If promise is not promise-like.
     */
    function track(promise, label) {
        const promiseType = typeof promise;
        if (
            promise === null ||
            (promiseType !== "object" && promiseType !== "function") ||
            typeof promise.then !== "function"
        ) {
            throw new TypeError("@ynode/autoshutdown: `track` requires a promise-like value");
        }

        const release = acquire(label);
        return Promise.resolve(promise).finally(release);
    }

    return { acquire, track };
}
