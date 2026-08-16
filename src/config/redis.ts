import { Redis } from "ioredis";
import { ENV } from "./environment.js";
import logger from "../utils/logger.util.js";

/**
 * The one Redis connection for ordinary commands.
 *
 * The event hub needs its own pair, because a client in subscriber mode cannot
 * issue normal commands, and the indexer lock keeps its own so a stalled lock
 * client cannot take rate limiting down with it. Everything else shares this.
 *
 * Created at module load rather than awaited, since rate limit stores are built
 * while the middleware is being defined. ioredis queues commands until the
 * socket is up, so an early request is delayed, never dropped.
 */
let client: Redis | null = null;

if (ENV.REDIS_URL) {
  client = new Redis(ENV.REDIS_URL, { maxRetriesPerRequest: 3 });
  client.on("error", (error) => logger.warn("Redis command client error:", error));
}

export const redisClient = client;

/** Raw command channel in the shape rate-limit-redis expects. */
type RedisReply = boolean | number | string | Array<boolean | number | string>;

export const sendRedisCommand: ((...args: string[]) => Promise<RedisReply>) | null =
  client
    ? (...args) =>
        client!.call(...(args as [string, ...string[]])) as Promise<RedisReply>
    : null;

export const closeRedisClient = async () => {
  await client?.quit().catch(() => undefined);
  client = null;
};
