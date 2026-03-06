export function createHeartbeatController({ state, reportLoad, memoryLimit, heartbeatInterval, log, shutdown }) {
    function stopHeartbeat() {
        if (state.intervalTimer) {
            clearInterval(state.intervalTimer);
            state.intervalTimer = null;
        }
    }

    function startHeartbeat() {
        if ((!reportLoad && memoryLimit === 0) || state.intervalTimer) {
            return;
        }

        let lastCheck = Date.now();
        state.intervalTimer = setInterval(() => {
            if (process.connected === false) {
                stopHeartbeat();
                return;
            }

            const now = Date.now();
            const lag = Math.max(0, now - lastCheck - heartbeatInterval);
            lastCheck = now;

            const mem = process.memoryUsage();
            if (memoryLimit > 0) {
                const rssMb = mem.rss / 1024 / 1024;
                if (rssMb > memoryLimit) {
                    log.warn({ rssMb, memoryLimit }, "Memory limit exceeded; shutting down");
                    void shutdown("memory_limit");
                    return;
                }
            }

            if (reportLoad && process.send) {
                process.send({ cmd: "heartbeat", lag, memory: mem });
            }
        }, heartbeatInterval);
    }

    return {
        startHeartbeat,
        stopHeartbeat,
    };
}
