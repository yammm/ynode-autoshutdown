import autoshutdown, {
    type AutoShutdownCommitEvent,
    type AutoShutdownCompleteEvent,
    type AutoshutdownOptions,
} from "@ynode/autoshutdown";
import Fastify from "fastify";

const options: AutoshutdownOptions = {
    sleep: 60,
    grace: 0,
    onShutdownCommit(event, app) {
        const committedAt: number = event.committedAt;
        app.log.info({ committedAt }, "shutdown committed");
    },
    onShutdownComplete(event) {
        const outcome: AutoShutdownCompleteEvent["outcome"] = event.outcome;
        void outcome;
    },
};

const app = Fastify();
await app.register(autoshutdown, options);
app.onAutoShutdown(async (instance) => instance === app);
app.onAutoShutdownCommit((event: AutoShutdownCommitEvent, instance) => {
    instance.log.info({ trigger: event.trigger });
});

const shutdown: Promise<void> = app.autoshutdown.shutdown("type-test");
const inFlight: number = app.autoshutdown.inFlight;
const nextAt: number | null = app.autoshutdown.nextAt;
void shutdown;
void inFlight;
void nextAt;
