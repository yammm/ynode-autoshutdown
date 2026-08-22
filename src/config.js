const MAX_TIMER_MS = 2 ** 31 - 1;

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
    closeTimeout: 10000, // ms
    memoryLimit: 0, // MB
    onShutdownStart: null,
    onShutdownComplete: null,
};

/**
 * Merges user-supplied options with defaults to produce a complete configuration.
 * @param {object} [options] - Partial plugin options.
 * @returns {object} Full configuration with all defaults applied.
 * @throws {TypeError} If any option key is not a recognized option.
 */
export function createConfig(options = {}) {
    const unknownKeys = Object.keys(options).filter((key) => !(key in DEFAULTS));
    if (unknownKeys.length > 0) {
        throw new TypeError(`@ynode/autoshutdown: unknown option(s): ${unknownKeys.join(", ")}`);
    }

    const definedOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
    );
    return { ...DEFAULTS, ...definedOptions };
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
        force,
        exitProcess,
        reportLoad,
        heartbeatInterval,
        hookTimeout,
        closeTimeout,
        memoryLimit,
        onShutdownStart,
        onShutdownComplete,
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
    if (ignoreUrls.some((pattern) => typeof pattern !== "string" && !(pattern instanceof RegExp))) {
        throw new Error(
            "@ynode/autoshutdown: `ignoreUrls` entries must be strings or RegExp objects",
        );
    }
    if (ignore !== null && typeof ignore !== "function") {
        throw new Error("@ynode/autoshutdown: `ignore` must be a function");
    }
    if (typeof force !== "boolean") {
        throw new Error("@ynode/autoshutdown: `force` must be a boolean");
    }
    if (typeof exitProcess !== "boolean") {
        throw new Error("@ynode/autoshutdown: `exitProcess` must be a boolean");
    }
    if (typeof reportLoad !== "boolean") {
        throw new Error("@ynode/autoshutdown: `reportLoad` must be a boolean");
    }
    if (!Number.isFinite(heartbeatInterval) || heartbeatInterval <= 0) {
        throw new Error("@ynode/autoshutdown: `heartbeatInterval` must be > 0");
    }
    if (!Number.isFinite(hookTimeout) || hookTimeout < 0) {
        throw new Error("@ynode/autoshutdown: `hookTimeout` must be >= 0");
    }
    if (!Number.isFinite(closeTimeout) || closeTimeout <= 0) {
        throw new Error("@ynode/autoshutdown: `closeTimeout` must be > 0");
    }
    if (!Number.isFinite(memoryLimit) || memoryLimit < 0) {
        throw new Error("@ynode/autoshutdown: `memoryLimit` must be >= 0");
    }
    if (onShutdownStart !== null && typeof onShutdownStart !== "function") {
        throw new Error("@ynode/autoshutdown: `onShutdownStart` must be a function");
    }
    if (onShutdownComplete !== null && typeof onShutdownComplete !== "function") {
        throw new Error("@ynode/autoshutdown: `onShutdownComplete` must be a function");
    }

    const timerValues = [
        ["sleep", sleep * 1000],
        ["grace", grace * 1000],
        ["jitter", jitter * 1000],
        ["heartbeatInterval", heartbeatInterval],
        ["hookTimeout", hookTimeout],
        ["closeTimeout", closeTimeout],
    ];
    for (const [name, value] of timerValues) {
        if (value > MAX_TIMER_MS) {
            throw new Error(`@ynode/autoshutdown: \`${name}\` exceeds Node.js timer limits`);
        }
    }
    if ((sleep + jitter) * 1000 > MAX_TIMER_MS) {
        throw new Error("@ynode/autoshutdown: `sleep + jitter` exceeds Node.js timer limits");
    }
}
