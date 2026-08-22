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

export interface AutoshutdownOptions {
    /** Inactivity period in seconds before shutdown. @default 1800 */
    sleep?: number;
    /** Grace period in seconds after startup before the timer arms. @default 30 */
    grace?: number;
    /** URL paths or patterns to exclude from idle timer tracking. @default [] */
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
    /** Max milliseconds for each graceful or forced Fastify close phase. @default 10000 */
    closeTimeout?: number;
    /** RSS threshold in MB that triggers shutdown (0 disables). @default 0 */
    memoryLimit?: number;
    /** Lifecycle hook called when shutdown starts. */
    onShutdownStart?:
        ((event: AutoShutdownStartEvent, app: FastifyInstance) => void | Promise<void>) | null;
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
        onAutoShutdownComplete(
            fn: (event: AutoShutdownCompleteEvent, app: FastifyInstance) => void | Promise<void>,
        ): void;
    }
}

export const autoshutdown: FastifyPluginAsync<AutoshutdownOptions>;
export default autoshutdown;
