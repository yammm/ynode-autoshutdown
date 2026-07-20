/**
 * Creates the shared mutable state object used across all plugin modules.
 * @returns {{ timer: null, graceTimer: null, intervalTimer: null, nextAt: null, inFlight: number, isShuttingDown: boolean, closeRequested: boolean, ignoredSymbol: symbol, trackedSymbol: symbol, settledSymbol: symbol }}
 */
export function createState() {
    return {
        timer: null,
        graceTimer: null,
        intervalTimer: null,
        nextAt: null,
        inFlight: 0,
        isShuttingDown: false,
        closeRequested: false,
        ignoredSymbol: Symbol("autoshutdown.ignored"),
        trackedSymbol: Symbol("autoshutdown.tracked"),
        settledSymbol: Symbol("autoshutdown.settled"),
    };
}
