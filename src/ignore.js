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

export function shouldIgnorePath(path, list) {
    if (!list?.length) {
        return false;
    }
    return list.some((p) => (typeof p === "string" ? p === path : p && typeof p.test === "function" && p.test(path)));
}

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
