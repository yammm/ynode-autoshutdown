# @ynode/autoshutdown

Copyright (c) 2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/autoshutdown.svg)](https://www.npmjs.com/package/@ynode/autoshutdown)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Fastify 5.x](https://www.fastify.io/) plugin that automatically shuts down idle cluster workers
after a period with zero in-flight requests. This is useful for conserving system resources in
environments where workers are scaled dynamically based on load.

The plugin arms an inactivity timer once the server is listening, cancels it while requests are in
flight, and re-arms it after the last response. When the timer expires, it runs any registered
cleanup hooks and, unless a hook vetoes shutdown by returning `false`, gracefully closes the Fastify
instance and exits the process.

## Why?

The primary benefit of this plugin is **resource efficiency**, especially in modern, scalable
deployments.

In environments that use the Node.js `cluster` module to spawn multiple workers, traffic is not
always evenly distributed. Some worker processes may become idle while others are busy. This plugin
identifies those idle workers and shuts them down, freeing up memory and CPU cycles without
affecting the overall application's availability.

This becomes even more powerful when combined with process managers like **systemd and its socket
activation** feature. The combination creates a highly efficient, on-demand system:

- **systemd socket activation**: Starts your application only when a request comes in.
- **Node.js clustering**: Scales your application across multiple CPU cores to handle the load.
- **`@ynode/autoshutdown`**: Scales down by removing _individual idle workers_ when they are no
  longer needed.

This allows your application to dynamically scale both up and down, ensuring you only use the
resources you absolutely need at any given moment. 🚀

## Installation

```bash
npm install @ynode/autoshutdown
```

## Basic Usage

Simply register the plugin with your Fastify instance.

```javascript
import Fastify from "fastify";
import autoShutdown from "@ynode/autoshutdown";

const app = Fastify({
    logger: true,
});

// Register the plugin with custom options
await app.register(autoShutdown, {
    sleep: 10 * 60, // 10 minutes of inactivity
    grace: 5, // 5-second grace period after startup
    ignoreUrls: ["/healthz", /\/admin\/.*/], // Strings or RegExp to ignore
});

app.get("/", (req, reply) => {
    reply.send({ hello: "world" });
});

app.get("/healthz", (req, reply) => {
    reply.send({ status: "ok" });
});

const start = async () => {
    try {
        await app.listen({ port: 3000 });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
```

## Options

The plugin accepts the following options:

| Option       | Type                      | Default | Description                                                                       |
| ------------ | ------------------------- | ------- | --------------------------------------------------------------------------------- |
| `sleep`      | `number`                  | `1800`  | The inactivity period in **seconds** before shutting down.                        |
| `grace`      | `number`                  | `5`     | A grace period in **seconds** after startup before the inactivity timer is armed. |
| `ignoreUrls` | `Array<string \| RegExp>` | `[]`    | An array of URL paths or `RegExp` patterns to ignore for timer logic.             |
| `jitter`     | `number`                  | `0`     | Adds a random delay (in **seconds**) to the sleep timer to avoid herd shutdowns.  |
| `force`             | `boolean`                 | `false` | If `true`, use `server.closeAllConnections()` after close. ⚠️ **Dangerous**.      |
| `reportLoad`        | `boolean`                 | `false` | If `true`, sends IPC heartbeat messages with Event Loop Lag and memory usage.     |
| `heartbeatInterval` | `number`                  | `2000`  | Interval in **milliseconds** for sending heartbeat messages (if `reportLoad` is on). |
| `hookTimeout`       | `number`                  | `5000`  | Maximum time in **milliseconds** to wait for an `onAutoShutdown` hook to resolve. |
| `memoryLimit`       | `number`                  | `0`     | Memory limit in **Megabytes** (RSS). If exceeded, the server shuts down. `0` = disabled. |

---

## Advanced Usage

### Vetoing a Shutdown with `onAutoShutdown`

You can register asynchronous hooks that run before a shutdown. If any of these hooks return
`false`, the shutdown is cancelled, and the timer is rescheduled. This is useful for preventing
shutdown while critical background tasks are running.

```javascript
let isTaskRunning = false;

// Register a hook to check the task status
app.onAutoShutdown(async (instance) => {
    if (isTaskRunning) {
        instance.log.warn("A critical task is running. Cancelling auto-shutdown!");
        return false; // This will cancel the shutdown
    }
    instance.log.info("No critical tasks running. Proceeding with cleanup...");
});

// Example routes to control the simulated task
app.get("/start-task", (request, reply) => {
    isTaskRunning = true;
    reply.send({ message: "Critical task started. Auto-shutdown will be blocked." });
});

app.get("/stop-task", (request, reply) => {
    isTaskRunning = false;
    reply.send({ message: "Critical task stopped. Auto-shutdown is now allowed." });
});
```

### Decorated Control Surface

The plugin decorates the Fastify instance with a control object, `fastify.autoshutdown`, for manual
control and inspection.

- **`app.autoshutdown.reset()`**: Manually arms/re-arms the idle timer.
- **`app.autoshutdown.cancel()`**: Manually cancels the timer.
- **`app.autoshutdown.inFlight`**: (getter) Returns the number of active, non-ignored requests.
- **`app.autoshutdown.nextAt`**: (getter) Returns the epoch timestamp (ms) when the timer will fire,
  or `null`.
- **`app.autoshutdown.delay`**: (getter) Returns the configured base delay in milliseconds.

```javascript
// Example: Manually reset the timer after a WebSocket message
webSocket.on("message", (data) => {
    // some logic...
    app.autoshutdown.reset();
});
```

### Resource-Based Shutdown

You can configure the plugin to automatically shut down the worker if it consumes too much memory (RSS). This is useful for "self-healing" long-running workers that might have memory leaks.

```javascript
await app.register(autoShutdown, {
    // ... other options
    memoryLimit: 512, // Shutdown if RSS > 512 MB
});
```

> **Note**: This check runs on the same interval as `heartbeatInterval` (default 2000ms), even if `reportLoad` is false.

### Load Reporting

When `reportLoad: true` is set, the plugin sends regular heartbeat messages to the parent process via IPC (if `process.send` is available). This is useful for external monitoring or load balancing.

**Message Format:**

```javascript
{
  cmd: "heartbeat",
  lag: 12,           // Event Loop Lag in ms
  memory: {          // process.memoryUsage()
    rss: ...,
    heapTotal: ...,
    heapUsed: ...,
    external: ...,
    arrayBuffers: ...
  }
}
```

This allows a process manager (like a custom cluster manager) to track the health and load of each worker.

**Parent Process Example:**

```javascript
import cluster from "node:cluster";

// In your primary process code:
cluster.on("message", (worker, message) => {
    if (message.cmd === "heartbeat") {
        console.log(`Worker ${worker.process.pid} lag: ${message.lag}ms`);
    }
});
```

## License

This project is licensed under the [MIT License](./LICENSE).
