import Fastify from "fastify";

import autoshutdown from "../src/plugin.js";

const app = Fastify({ logger: true });

// Register the plugin to automatically shut down the Fastify server
// after 10,000 milliseconds (10 seconds) of zero HTTP requests.
await app.register(autoshutdown, {
    sleep: 10000,
});

app.get("/", async (request, reply) => {
    return { status: "running", message: "Server will shut down after 10 seconds of inactivity." };
});

try {
    await app.listen({ port: 3000 });
    console.log("Server listening at http://localhost:3000");
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
