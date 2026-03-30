const DEFAULTS = {
    sleep: 30 * 60, // seconds
    grace: 30, // seconds
    ignoreUrls: [],
    ignore: null,
    jitter: 5, // seconds
    force: false,
    exitProcess: true,
    reportLoad: false,
    heartbeatInterval: 2000, // ms
    hookTimeout: 5000, // ms
    memoryLimit: 0, // MB
    onShutdownStart: null,
    onShutdownComplete: null,
};

/**
 * Merges user-supplied options with defaults to produce a complete configuration.
 * @param {object} [options] - Partial plugin options.
 * @returns {object} Full configuration with all defaults applied.
 */
export function createConfig(options = {}) {
    return { ...DEFAULTS, ...options };
}

/**
 * Validates a merged configuration object, throwing on invalid values.
 * @param {object} cfg - Full configuration to validate.
 * @throws {Error} If any option is out of range or the wrong type.
 */
export function validateConfig(cfg) {
    const {
        sleep,
        grace,
        jitter,
        ignoreUrls,
        ignore,
        exitProcess,
        heartbeatInterval,
        hookTimeout,
        memoryLimit,
    } = cfg;

    if (!Number.isFinite(sleep) || sleep <= 0) {
        throw new Error("@ynode/autoshutdown: `sleep` must be > 0");
    }
    if (!Number.isFinite(grace) || grace < 0) {
        throw new Error("@ynode/autoshutdown: `grace` must be >= 0");
    }
    if (!Number.isFinite(jitter) || jitter < 0) {
        throw new Error("@ynode/autoshutdown: `jitter` must be >= 0");
    }
    if (!Array.isArray(ignoreUrls)) {
        throw new Error("@ynode/autoshutdown: `ignoreUrls` must be an array");
    }
    if (ignore !== null && typeof ignore !== "function") {
        throw new Error("@ynode/autoshutdown: `ignore` must be a function");
    }
    if (typeof exitProcess !== "boolean") {
        throw new Error("@ynode/autoshutdown: `exitProcess` must be a boolean");
    }
    if (!Number.isFinite(heartbeatInterval) || heartbeatInterval <= 0) {
        throw new Error("@ynode/autoshutdown: `heartbeatInterval` must be > 0");
    }
    if (!Number.isFinite(hookTimeout) || hookTimeout < 0) {
        throw new Error("@ynode/autoshutdown: `hookTimeout` must be >= 0");
    }
    if (!Number.isFinite(memoryLimit) || memoryLimit < 0) {
        throw new Error("@ynode/autoshutdown: `memoryLimit` must be >= 0");
    }
}
