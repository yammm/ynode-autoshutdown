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
 * Creates the shared mutable state object used across all plugin modules.
 * @returns {{ timer: null, graceTimer: null, intervalTimer: null, nextAt: null, inFlight: number, activityLeases: Map<symbol, string|null>, hasListened: boolean, isShuttingDown: boolean, closeRequested: boolean, ignoredSymbol: symbol, trackedSymbol: symbol, settledSymbol: symbol }}
 */
export function createState() {
    return {
        timer: null,
        graceTimer: null,
        intervalTimer: null,
        nextAt: null,
        inFlight: 0,
        activityLeases: new Map(),
        hasListened: false,
        isShuttingDown: false,
        closeRequested: false,
        ignoredSymbol: Symbol("autoshutdown.ignored"),
        trackedSymbol: Symbol("autoshutdown.tracked"),
        settledSymbol: Symbol("autoshutdown.settled"),
    };
}
