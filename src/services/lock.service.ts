import { Redis } from "ioredis";
import { ENV } from "../config/environment.js";
import logger from "../utils/logger.util.js";

/**
 * Single-holder lock used to elect one indexer leader.
 *
 * Every instance running the block cursor would mean duplicated RPC calls and a
 * cursor several instances race to advance. Writes are idempotent so nothing
 * corrupts, but the work is wasted. With no Redis configured this always grants
 * the lock, which is correct for a single instance.
 */
export class DistributedLock {
  private client: Redis | null = null;
  private readonly token = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  private held = false;

  constructor(
    private readonly key: string,
    private readonly ttlMs: number
  ) {}

  async connect() {
    if (!ENV.REDIS_URL) return;

    try {
      this.client = new Redis(ENV.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
      await this.client.connect();
      this.client.on("error", (e) => logger.warn(`Lock client error (${this.key}):`, e));
    } catch (error) {
      logger.error(`❌ Lock client failed to connect, running unlocked:`, error);
      this.client = null;
    }
  }

  /**
   * Take the lock, or extend it if this instance already holds it. Extending is
   * guarded by the token so a leader that stalled past the TTL cannot reclaim a
   * lock another instance has since taken.
   */
  async acquire(): Promise<boolean> {
    if (!this.client) return true;

    try {
      if (this.held) {
        const extended = await this.client.eval(
          `if redis.call("get", KEYS[1]) == ARGV[1] then
             return redis.call("pexpire", KEYS[1], ARGV[2])
           else
             return 0
           end`,
          1,
          this.key,
          this.token,
          this.ttlMs
        );

        this.held = extended === 1;
        if (this.held) return true;
      }

      const result = await this.client.set(this.key, this.token, "PX", this.ttlMs, "NX");
      this.held = result === "OK";

      if (this.held) logger.info(`🔒 Acquired ${this.key}, this instance is leader`);
      return this.held;
    } catch (error) {
      logger.warn(`Lock acquire failed for ${this.key}:`, error);
      return false;
    }
  }

  async release() {
    if (!this.client || !this.held) return;

    try {
      await this.client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then
           return redis.call("del", KEYS[1])
         else
           return 0
         end`,
        1,
        this.key,
        this.token
      );
    } catch {
      // The TTL expires it anyway.
    }

    this.held = false;
  }

  async disconnect() {
    await this.release();
    await this.client?.quit().catch(() => undefined);
    this.client = null;
  }
}
