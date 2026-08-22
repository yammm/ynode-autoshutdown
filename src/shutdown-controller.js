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
 * Creates a one-time shutdown-handler relay used to resolve the intentional
 * timer/heartbeat dependency cycle without a late-bound function variable.
 * @returns {{ bind: function, run: function }} One-time handler relay.
 */
export function createShutdownController() {
    let handler = null;

    return Object.freeze({
        bind(nextHandler) {
            if (handler !== null) {
                throw new Error("@ynode/autoshutdown: shutdown handler is already bound");
            }
            if (typeof nextHandler !== "function") {
                throw new TypeError("@ynode/autoshutdown: shutdown handler must be a function");
            }
            handler = nextHandler;
        },
        run(trigger) {
            if (handler === null) {
                throw new Error("@ynode/autoshutdown: shutdown handler is not bound");
            }
            return handler(trigger);
        },
    });
}
