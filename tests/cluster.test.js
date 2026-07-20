import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const fixture = fileURLToPath(new URL("./fixtures/cluster-idle-worker.js", import.meta.url));

test("idle shutdown is a voluntary Node cluster exit", async () => {
    const { stdout } = await execFileAsync(process.execPath, [fixture], { timeout: 7500 });
    const result = JSON.parse(stdout.trim().split("\n").at(-1));

    assert.deepStrictEqual(result, {
        code: 0,
        signal: null,
        exitedAfterDisconnect: true,
    });
});

test("failed shutdown remains a non-voluntary Cluster exit", async () => {
    const { stdout } = await execFileAsync(process.execPath, [fixture], {
        timeout: 7500,
        env: { ...process.env, AUTOSHUTDOWN_TEST_FAILURE: "1" },
    });
    const result = JSON.parse(stdout.trim().split("\n").at(-1));

    assert.deepStrictEqual(result, {
        code: 1,
        signal: null,
        exitedAfterDisconnect: false,
    });
});
