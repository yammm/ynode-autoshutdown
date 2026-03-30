/**
 * Creates the shared mutable state object used across all plugin modules.
 * @returns {{ timer: null, intervalTimer: null, nextAt: null, inFlight: number, isShuttingDown: boolean, ignoredSymbol: symbol }}
 */
export function createState() {
    return {
        timer: null,
        intervalTimer: null,
        nextAt: null,
        inFlight: 0,
        isShuttingDown: false,
        ignoredSymbol: Symbol("autoshutdown.ignored"),
    };
}
