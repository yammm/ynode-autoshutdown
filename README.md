# @ynode/autoshutdown

Copyright (c) 2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/autoshutdown.svg)](https://www.npmjs.com/package/@ynode/autoshutdown)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Fastify 5.x](https://www.fastify.io/) plugin that automatically shuts down idle cluster workers after a period with
zero in-flight requests. This is useful for conserving system resources in environments where workers are scaled
dynamically based on load.

The plugin arms an inactivity timer once the server is listening, cancels it while requests are in flight, and re-arms
it after the last response. When the timer expires, it runs any registered cleanup hooks and, unless a hook vetoes
shutdown by returning `false`, gracefully closes the Fastify instance and exits the process.

## Why?

The primary benefit of this plugin is **resource efficiency**, especially in modern, scalable deployments.

In environments that use the Node.js `cluster` module to spawn multiple workers, traffic is not always evenly
distributed. Some worker processes may become idle while others are busy. This plugin identifies those idle workers and
shuts them down, freeing up memory and CPU cycles without affecting the overall application's availability.

This becomes even more powerful when combined with process managers like **systemd and its socket activation** feature.
The combination creates a highly efficient, on-demand system:

- **systemd socket activation**: Starts your application only when a request comes in.
- **Node.js clustering**: Scales your application across multiple CPU cores to handle the load.
- **`@ynode/autoshutdown`**: Scales down by removing _individual idle workers_ when they are no longer needed.

This allows your application to dynamically scale both up and down, ensuring you only use the resources you absolutely
need at any given moment. 🚀

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

| Option               | Type                         | Default | Description                                                                              |
| -------------------- | ---------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `sleep`              | `number`                     | `1800`  | The inactivity period in **seconds** before shutting down.                               |
| `grace`              | `number`                     | `30`    | A grace period in **seconds** after startup before the inactivity timer is armed.        |
| `ignoreUrls`         | `Array<string \| RegExp>`    | `[]`    | An array of URL paths or `RegExp` patterns to ignore for timer logic.                    |
| `ignore`             | `(request, path) => boolean` | `null`  | Optional function matcher for ignore logic. Return `true` to ignore that request.        |
| `jitter`             | `number`                     | `5`     | Adds a random delay (in **seconds**) to the sleep timer to avoid herd shutdowns.         |
| `force`              | `boolean`                    | `false` | If `true`, use `server.closeAllConnections()` after close. ⚠️ **Dangerous**.             |
| `exitProcess`        | `boolean`                    | `true`  | If `false`, plugin closes Fastify but does not call `process.exit(...)`.                 |
| `reportLoad`         | `boolean`                    | `false` | If `true`, sends IPC heartbeat messages with Event Loop Lag and memory usage.            |
| `heartbeatInterval`  | `number`                     | `2000`  | Interval in **milliseconds** for heartbeats and memory checks (**must be > 0**).         |
| `hookTimeout`        | `number`                     | `5000`  | Maximum time in **milliseconds** to wait for an `onAutoShutdown` hook to resolve.        |
| `memoryLimit`        | `number`                     | `0`     | Memory limit in **Megabytes** (RSS). If exceeded, the server shuts down. `0` = disabled. |
| `onShutdownStart`    | `(event, app) => void`       | `null`  | Optional lifecycle observer called when shutdown starts.                                 |
| `onShutdownComplete` | `(event, app) => void`       | `null`  | Optional lifecycle observer called with outcome (`closed`, `vetoed`, `error`).           |

---

## Timing Units (Reference)

| Option              | Unit            | Example                  |
| ------------------- | --------------- | ------------------------ |
| `sleep`             | seconds         | `600` = 10 minutes       |
| `grace`             | seconds         | `30` = 30 seconds        |
| `jitter`            | seconds         | `5` = up to 5s of jitter |
| `heartbeatInterval` | milliseconds    | `2000` = 2 seconds       |
| `hookTimeout`       | milliseconds    | `5000` = 5 seconds       |
| `memoryLimit`       | megabytes (RSS) | `512` = 512 MB RSS       |

```javascript
await app.register(autoShutdown, {
    sleep: 15 * 60, // seconds
    grace: 30, // seconds
    jitter: 5, // seconds
    heartbeatInterval: 2000, // ms
    hookTimeout: 5000, // ms
    memoryLimit: 512, // MB (RSS)
});
```

## Behavior Matrix

| Situation                             | `inFlight`  | Timer Action                 | Shutdown Result                             |
| ------------------------------------- | ----------- | ---------------------------- | ------------------------------------------- |
| Startup grace period                  | `0`         | Timer waits until grace ends | No shutdown during grace                    |
| Non-ignored request starts            | `+1`        | Timer is cancelled           | Shutdown paused while request runs          |
| Last non-ignored response completes   | back to `0` | Timer is re-armed            | Shutdown may occur after `sleep` (+ jitter) |
| Ignored request (string/RegExp match) | unchanged   | Timer is unchanged           | Request does not delay shutdown             |
| Hook returns `false`                  | unchanged   | Timer is re-armed            | Shutdown is vetoed for that cycle           |
| Hook throws or times out              | unchanged   | Continue current shutdown    | Shutdown proceeds                           |
| RSS exceeds `memoryLimit`             | unchanged   | Immediate shutdown sequence  | Worker exits after close sequence           |

## Production Caveats

- The plugin calls `process.exit(0)` after successful shutdown and `process.exit(1)` if `fastify.close()` fails.
- Set `exitProcess: false` when this plugin runs in-process with other workloads and you do not want worker exit
  behavior.
- In the same Fastify encapsulation scope, duplicate plugin registration is skipped with a warning.
- String `ignoreUrls` are exact path matches; query strings are stripped before matching. Use `RegExp` for pattern-based
  matching.
- Use `ignore(request, path)` for method/header/query-aware matching.
- `force: true` calls `server.closeAllConnections()` and may drop active clients abruptly.
- `heartbeatInterval` drives both heartbeat emission and memory-limit checks, so very low values can add overhead.

## Advanced Usage

### Vetoing a Shutdown with `onAutoShutdown`

You can register asynchronous hooks that run before a shutdown. If any of these hooks return `false`, the shutdown is
cancelled, and the timer is rescheduled. This is useful for preventing shutdown while critical background tasks are
running.

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

### Lifecycle Hooks (Metrics / Observability)

You can observe shutdown lifecycles either through registration options or decorators:

- `onShutdownStart(event, app)`
- `onShutdownComplete(event, app)`
- `app.onAutoShutdownStart(fn)`
- `app.onAutoShutdownComplete(fn)`

`event` includes fields such as:

- `trigger`: `"idle_timer"` or `"memory_limit"`
- `startedAt`, `completedAt`, `durationMs`
- `outcome`: `"closed"`, `"vetoed"`, or `"error"` (complete hook)
- `pid`, `inFlight`, `nextAt`

```javascript
await app.register(autoShutdown, {
    sleep: 10 * 60,
    exitProcess: false,
    onShutdownStart: (event) => {
        app.log.info({ event }, "shutdown started");
    },
    onShutdownComplete: (event) => {
        app.log.info({ event }, "shutdown finished");
    },
});

app.onAutoShutdownComplete((event) => {
    if (event.outcome === "error") {
        app.log.error({ event }, "shutdown failed");
    }
});
```

### Custom Ignore Matcher

When URL/RegExp matching is not enough, use `ignore(request, path)` to define dynamic logic:

```javascript
await app.register(autoShutdown, {
    sleep: 10 * 60,
    ignore: (request, path) => {
        // Ignore GET health checks and metrics probes
        return request.method === "GET" && (path === "/healthz" || path.startsWith("/metrics"));
    },
});
```

### Decorated Control Surface

The plugin decorates the Fastify instance with a control object, `fastify.autoshutdown`, for manual control and
inspection.

- **`app.autoshutdown.reset()`**: Manually arms/re-arms the idle timer.
- **`app.autoshutdown.cancel()`**: Manually cancels the timer.
- **`app.autoshutdown.inFlight`**: (getter) Returns the number of active, non-ignored requests.
- **`app.autoshutdown.nextAt`**: (getter) Returns the epoch timestamp (ms) when the timer will fire, or `null`.
- **`app.autoshutdown.delay`**: (getter) Returns the configured base delay in milliseconds.

```javascript
// Example: Manually reset the timer after a WebSocket message
webSocket.on("message", (data) => {
    // some logic...
    app.autoshutdown.reset();
});
```

### Resource-Based Shutdown

You can configure the plugin to automatically shut down the worker if it consumes too much memory (RSS). This is useful
for "self-healing" long-running workers that might have memory leaks.

```javascript
await app.register(autoShutdown, {
    // ... other options
    memoryLimit: 512, // Shutdown if RSS > 512 MB
});
```

> **Note**: This check runs on the same interval as `heartbeatInterval` (default 2000ms), even if `reportLoad` is false.

### Load Reporting

When `reportLoad: true` is set, the plugin sends regular heartbeat messages to the parent process via IPC (if
`process.send` is available). This is useful for external monitoring or load balancing.

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

## Release Process

This package uses [`@mikinho/autover`](https://github.com/yammm/ynode-autover) for automated versioning and changelog generation. 

To release a new version seamlessly:
1. Make your code changes in a branch.
2. Open a Pull Request against `main`.
3. Add the **`autover-apply`** label to the Pull Request.
4. Merge the Pull Request.

Upon merge, the GitHub Action runner will automatically bump the package version, update the `CHANGELOG.md`, create a Git tag, and commit the release directly to `main`.

> **Note:** Direct commits to `main` are supported but will gracefully skip the `autover` pipeline to prevent versioning collisions.
