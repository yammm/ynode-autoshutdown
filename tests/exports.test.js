import assert from "node:assert/strict";
import { test } from "node:test";

import autoShutdown, { autoshutdown } from "../src/plugin.js";

test("named and default plugin exports reference the same plugin", () => {
    assert.strictEqual(autoshutdown, autoShutdown);
});
