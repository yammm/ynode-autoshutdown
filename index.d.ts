import { FastifyPluginAsync } from "fastify";

export interface AutoshutdownOptions {
    /**
     * Timeout in milliseconds to wait for connections to close gracefully before forcefully closing.
     * @default 10000
     */
    grace?: number;
}

export const autoshutdown: FastifyPluginAsync<AutoshutdownOptions>;
export default autoshutdown;
