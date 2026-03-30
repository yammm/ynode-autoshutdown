/**
 * Creates the heartbeat controller for IPC load reporting and memory limit enforcement.
 * @param {object} deps - Injected dependencies.
 * @param {object} deps.state - Shared mutable state (intervalTimer).
 * @param {boolean} deps.reportLoad - Whether to send IPC heartbeat messages via process.send.
 * @param {number} deps.memoryLimit - RSS threshold in MB that triggers shutdown (0 disables).
 * @param {number} deps.heartbeatInterval - Interval in milliseconds between heartbeat ticks.
 * @param {object} deps.log - Child logger instance.
 * @param {function(string): Promise<void>} deps.shutdown - Shutdown handler for memory limit breach.
 * @returns {{ startHeartbeat: function(): void, stopHeartbeat: function(): void }}
 */
export function createHeartbeatController({
    state,
    reportLoad,
    memoryLimit,
    heartbeatInterval,
    log,
    shutdown,
}) {
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
            // Event loop lag: drift from expected interval indicates scheduler contention
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
