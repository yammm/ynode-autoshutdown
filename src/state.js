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
