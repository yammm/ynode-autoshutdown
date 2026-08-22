import { FastifyPluginAsync, FastifyInstance, FastifyRequest } from "fastify";

export interface AutoShutdownStartEvent {
    /**
     * Shutdown source. Built-in triggers include "idle_timer" and
     * "memory_limit"; integrators may see other string values from direct
     * shutdown orchestration.
     */
    trigger: string;
    pid: number;
    inFlight: number;
    nextAt: number | null;
    startedAt: number;
}

export interface AutoShutdownCompleteEvent extends AutoShutdownStartEvent {
    completedAt: number;
    durationMs: number;
    outcome: "closed" | "vetoed" | "error";
    error?: Error;
}

export interface AutoShutdownCommitEvent extends AutoShutdownStartEvent {
    /** Epoch timestamp (ms) when all veto hooks had accepted shutdown. */
    committedAt: number;
}

export interface AutoshutdownOptions {
    /** Inactivity period in seconds before shutdown. @default 1800 */
    sleep?: number;
    /** Grace period in seconds after startup before the timer arms. @default 30 */
    grace?: number;
    /**
     * Route patterns (e.g. "/users/:id") or RegExp patterns to exclude from
     * idle timer tracking. Matched against the Fastify route pattern, with a
     * raw-URL fallback (query string stripped) only for unrouted 404s.
     * @default []
     */
    ignoreUrls?: (string | RegExp)[];
    /** Custom predicate to exclude requests from idle timer tracking. */
    ignore?: ((request: FastifyRequest, path: string) => boolean) | null;
    /** Random jitter in seconds added to the delay to stagger herd exits. @default 5 */
    jitter?: number;
    /** If true, calls server.closeAllConnections() when graceful close times out. @default false */
    force?: boolean;
    /** If false, closes Fastify but does not call process.exit(). @default true */
    exitProcess?: boolean;
    /** If true, sends IPC heartbeat messages via process.send(). @default false */
    reportLoad?: boolean;
    /** Heartbeat interval in milliseconds. @default 2000 */
    heartbeatInterval?: number;
    /** Max milliseconds per shutdown hook; with 0, hooks must settle before the next timer turn. @default 5000 */
    hookTimeout?: number;
    /**
     * Max milliseconds for each graceful or forced Fastify close phase. A phase
     * that exceeds the timeout is reported as an "error" outcome while the
     * underlying fastify.close() continues in the background; its eventual
     * completion or failure is logged.
     * @default 10000
     */
    closeTimeout?: number;
    /** RSS threshold in MB that triggers shutdown (0 disables). @default 0 */
    memoryLimit?: number;
    /** Lifecycle hook called when shutdown starts. */
    onShutdownStart?:
        ((event: AutoShutdownStartEvent, app: FastifyInstance) => void | Promise<void>) | null;
    /** Lifecycle hook called after all veto hooks accept, immediately before Fastify closes. */
    onShutdownCommit?:
        ((event: AutoShutdownCommitEvent, app: FastifyInstance) => void | Promise<void>) | null;
    /** Lifecycle hook called when shutdown completes, is vetoed, or errors. */
    onShutdownComplete?:
        ((event: AutoShutdownCompleteEvent, app: FastifyInstance) => void | Promise<void>) | null;
}

export interface AutoshutdownControl {
    /**
     * Arms or re-arms the idle timer; ignored before the server is listening,
     * during active startup grace, while requests are in flight, or after
     * closing starts.
     */
    reset(): void;
    /** Cancels the idle shutdown timer. */
    cancel(): void;
    /**
     * Initiates the shutdown sequence with a custom trigger name that is
     * passed through to lifecycle hook events. No-op if a shutdown is already
     * in progress. Concurrent calls join the active attempt. Throws a TypeError
     * if trigger is not a non-empty string.
     * @param trigger Non-empty trigger name. @default "manual"
     */
    shutdown(trigger?: string): Promise<void>;
    /** Current number of in-flight requests. */
    readonly inFlight: number;
    /** Epoch timestamp (ms) when the timer will fire, or null if not armed. */
    readonly nextAt: number | null;
    /** Configured base delay in milliseconds. */
    readonly delay: number;
}

declare module "fastify" {
    interface FastifyInstance {
        autoshutdown: AutoshutdownControl;
        onAutoShutdown(
            fn: (app: FastifyInstance) => boolean | void | Promise<boolean | void>,
        ): void;
        onAutoShutdownStart(
            fn: (event: AutoShutdownStartEvent, app: FastifyInstance) => void | Promise<void>,
        ): void;
        onAutoShutdownCommit(
            fn: (event: AutoShutdownCommitEvent, app: FastifyInstance) => void | Promise<void>,
        ): void;
        onAutoShutdownComplete(
            fn: (event: AutoShutdownCompleteEvent, app: FastifyInstance) => void | Promise<void>,
        ): void;
    }
}

export const autoshutdown: FastifyPluginAsync<AutoshutdownOptions>;
export default autoshutdown;
