import cluster from "node:cluster";

import Fastify from "fastify";

import autoShutdown from "../../src/plugin.js";

if (cluster.isPrimary) {
    const expectFailure = process.env.AUTOSHUTDOWN_TEST_FAILURE === "1";
    const worker = cluster.fork();
    const timeout = setTimeout(() => {
        worker.kill("SIGKILL");
        process.exitCode = 1;
    }, 5000);

    worker.once("exit", (code, signal) => {
        clearTimeout(timeout);
        const result = { code, signal, exitedAfterDisconnect: worker.exitedAfterDisconnect };
        console.log(JSON.stringify(result));
        const exitedAsExpected = expectFailure
            ? code === 1 && signal === null && !worker.exitedAfterDisconnect
            : code === 0 && signal === null && worker.exitedAfterDisconnect;
        process.exitCode = exitedAsExpected ? 0 : 1;
    });
} else {
    const app = Fastify();
    if (process.env.AUTOSHUTDOWN_TEST_FAILURE === "1") {
        app.addHook("onClose", async () => {
            throw new Error("simulated close failure");
        });
    }
    await app.register(autoShutdown, {
        sleep: 0.05,
        grace: 0,
        jitter: 0,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
}
