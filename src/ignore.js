/**
 * Strips the query string from a URL path.
 * @param {string} path - Raw request path (may include query string).
 * @returns {string} Path without query string, or empty string if input is not a string.
 */
export function normalizePath(path) {
    if (typeof path !== "string") {
        return "";
    }

    const idx = path.indexOf("?");
    if (idx === -1) {
        return path;
    }
    return path.slice(0, idx);
}

/**
 * Tests whether a normalized path matches any entry in an ignore list.
 * @param {string} path - Normalized request path (no query string).
 * @param {Array<string|RegExp>} list - Ignore patterns (exact strings or RegExp).
 * @returns {boolean} True if the path matches any entry.
 */
export function shouldIgnorePath(path, list) {
    if (!list?.length) {
        return false;
    }
    return list.some((p) =>
        typeof p === "string" ? p === path : p && typeof p.test === "function" && p.test(path),
    );
}

/**
 * Determines whether a request should be excluded from idle timer tracking.
 * Checks the ignoreUrls list first, then falls back to the custom ignore function.
 * @param {object} deps - Evaluation context.
 * @param {object} deps.request - Fastify request object.
 * @param {string} deps.path - Normalized request path.
 * @param {Array<string|RegExp>} deps.ignoreUrls - Static ignore patterns.
 * @param {function|null} deps.ignore - Optional custom matcher function.
 * @param {object} deps.log - Child logger instance.
 * @returns {boolean} True if the request should be ignored.
 */
export function shouldIgnoreRequest({ request, path, ignoreUrls, ignore, log }) {
    if (shouldIgnorePath(path, ignoreUrls)) {
        return true;
    }

    if (typeof ignore === "function") {
        try {
            return Boolean(ignore(request, path));
        } catch (err) {
            log.warn({ err }, "Error in `ignore` matcher (ignored)");
        }
    }

    return false;
}
