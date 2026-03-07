export function createTimerController({ state, delay, jitter, shutdown }) {
    function cancel() {
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
            state.nextAt = null;
        }
    }

    function schedule() {
        if (state.isShuttingDown) {
            return null;
        }

        cancel();
        if (state.inFlight > 0) {
            return null;
        }

        const jitterMs = jitter > 0 ? Math.floor(Math.random() * Math.min(jitter * 1000, delay / 3)) : 0;
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
