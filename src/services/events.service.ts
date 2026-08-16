import { Response } from "express";
import { Redis } from "ioredis";
import { ENV } from "../config/environment.js";
import logger from "../utils/logger.util.js";

export type DizburzaEvent =
  | { type: "transaction"; address: string; txHash: string; direction: "sent" | "received" }
  | { type: "balance"; address: string; raw: string; decimals: number }
  // Routed on the organization's contract address, which members already
  // subscribe to and non-members are already refused. Governance activity
  // needs no authorization surface of its own.
  | {
      type: "proposal";
      address: string;
      organizationId: string;
      proposalId: string;
      action: "created" | "voted" | "decided" | "cancelled";
    }
  // Routed on the sender's own address, which is the only party that may see a
  // link's history. A claimer learns the outcome from their own balance.
  | { type: "cashlink"; address: string; claimAddress: string; status: string };

type Subscriber = {
  id: string;
  addresses: Set<string>;
  res: Response;
  ip: string;
};

const CHANNEL = "dizburza:events";

/**
 * SSE hub.
 *
 * The dashboard used to learn about new activity only by refetching, which is
 * what made the app feel like it was constantly reloading. Pushing lets the
 * client sit idle and update the moment the indexer writes something.
 *
 * A browser is connected to exactly one API instance, so a publish that only
 * reaches local memory is invisible to everyone attached elsewhere. With
 * REDIS_URL set, every publish goes out over pub/sub and each instance delivers
 * to its own subscribers. Without it the hub still works, but only for a single
 * instance.
 */
class EventHub {
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly connectionsByIp = new Map<string, number>();
  private heartbeat: NodeJS.Timeout | null = null;
  private publisher: Redis | null = null;
  private receiver: Redis | null = null;

  /**
   * A normal user needs one stream, or a few across tabs. This is exempt from
   * the general rate limiter (one long-lived request would otherwise burn the
   * per-IP budget), so it needs its own ceiling.
   */
  private static readonly MAX_PER_IP = 10;

  countForIp(ip: string): number {
    return this.connectionsByIp.get(ip) ?? 0;
  }

  /**
   * Two connections because a Redis client in subscriber mode cannot issue
   * normal commands.
   */
  async connect() {
    if (!ENV.REDIS_URL) {
      logger.warn(
        "⚠️  REDIS_URL not set. Realtime events stay within this process, " +
          "which is fine for one instance but breaks if you scale out."
      );
      return;
    }

    try {
      this.publisher = new Redis(ENV.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
      this.receiver = new Redis(ENV.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });

      await Promise.all([this.publisher.connect(), this.receiver.connect()]);

      await this.receiver.subscribe(CHANNEL);
      this.receiver.on("message", (_channel, payload) => {
        try {
          this.deliver(JSON.parse(payload) as DizburzaEvent);
        } catch (error) {
          logger.warn("Dropping malformed realtime event:", error);
        }
      });

      // ioredis reconnects on its own; log so a flapping Redis is visible.
      this.publisher.on("error", (e) => logger.warn("Redis publisher error:", e));
      this.receiver.on("error", (e) => logger.warn("Redis receiver error:", e));

      logger.info("📡 Realtime events fanning out over Redis");
    } catch (error) {
      logger.error("❌ Redis connect failed, falling back to in-process events:", error);
      this.publisher = null;
      this.receiver = null;
    }
  }

  subscribe(addresses: string[], res: Response, ip: string): (() => void) | null {
    if (this.countForIp(ip) >= EventHub.MAX_PER_IP) {
      logger.warn(`Refusing SSE connection from ${ip}, at connection limit`);
      return null;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalized = new Set(addresses.map((a) => a.toLowerCase()));

    this.subscribers.set(id, { id, addresses: normalized, res, ip });
    this.connectionsByIp.set(ip, this.countForIp(ip) + 1);
    this.ensureHeartbeat();

    logger.debug(`📡 SSE subscriber ${id} attached (${this.subscribers.size} total)`);

    return () => this.drop(id);
  }

  private drop(id: string) {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) return;

    this.subscribers.delete(id);

    const remaining = this.countForIp(subscriber.ip) - 1;
    if (remaining > 0) this.connectionsByIp.set(subscriber.ip, remaining);
    else this.connectionsByIp.delete(subscriber.ip);

    if (this.subscribers.size === 0) this.stopHeartbeat();
  }

  publish(event: DizburzaEvent) {
    if (!this.publisher) {
      this.deliver(event);
      return;
    }

    // Redis echoes back to this instance too, so don't also deliver locally or
    // every client attached here gets the event twice.
    this.publisher.publish(CHANNEL, JSON.stringify(event)).catch((error) => {
      logger.warn("Redis publish failed, delivering locally instead:", error);
      this.deliver(event);
    });
  }

  /** Write an event to the subscribers held by this instance. */
  private deliver(event: DizburzaEvent) {
    const target = event.address.toLowerCase();

    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.addresses.has(target)) continue;

      try {
        subscriber.res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (error) {
        logger.warn(`SSE write failed for ${subscriber.id}, dropping:`, error);
        this.drop(subscriber.id);
      }
    }
  }

  private ensureHeartbeat() {
    if (this.heartbeat) return;

    // Proxies close idle connections. A comment frame keeps the stream alive
    // without the client having to reconnect.
    this.heartbeat = setInterval(() => {
      for (const subscriber of this.subscribers.values()) {
        try {
          subscriber.res.write(`: keep-alive\n\n`);
        } catch {
          this.drop(subscriber.id);
        }
      }
    }, 25_000);
  }

  private stopHeartbeat() {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  async shutdown() {
    this.stopHeartbeat();

    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.res.end();
      } catch {
        // connection already gone
      }
    }
    this.subscribers.clear();
    this.connectionsByIp.clear();

    await Promise.all([
      this.publisher?.quit().catch(() => undefined),
      this.receiver?.quit().catch(() => undefined),
    ]);

    this.publisher = null;
    this.receiver = null;
  }
}

export const eventHub = new EventHub();
