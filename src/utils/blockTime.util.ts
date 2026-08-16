import { provider } from "../config/blockchain.js";
import logger from "./logger.util.js";

// Block timestamps are immutable once finalized, so they cache indefinitely.
// Bounded to keep a long backfill from growing the map without limit.
const MAX_CACHED_BLOCKS = 10_000;
const cache = new Map<number, number>();

const remember = (blockNumber: number, timestamp: number) => {
  if (cache.size >= MAX_CACHED_BLOCKS) {
    // Map preserves insertion order, so the first key is the oldest entry.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(blockNumber, timestamp);
};

/**
 * Unix seconds for a block, or undefined if it can't be resolved.
 */
export const getBlockTimestamp = async (
  blockNumber?: number
): Promise<number | undefined> => {
  if (blockNumber === undefined || !Number.isFinite(blockNumber)) return undefined;

  const hit = cache.get(blockNumber);
  if (hit !== undefined) return hit;

  try {
    const block = await provider.getBlock(blockNumber);
    if (!block) return undefined;
    remember(blockNumber, block.timestamp);
    return block.timestamp;
  } catch (error) {
    logger.warn(`Could not resolve timestamp for block ${blockNumber}:`, error);
    return undefined;
  }
};

/**
 * Wall-clock Date for a block. Callers fall back to Date.now() when this is
 * undefined, but should prefer the block time so time-range queries stay
 * correct for backfilled rows.
 */
export const getBlockDate = async (
  blockNumber?: number
): Promise<Date | undefined> => {
  const seconds = await getBlockTimestamp(blockNumber);
  return seconds === undefined ? undefined : new Date(seconds * 1000);
};

/**
 * Warm the cache for several blocks at once. Duplicates collapse to one RPC
 * call, which matters during backfill where many logs share a block.
 */
export const primeBlockTimestamps = async (blockNumbers: number[]) => {
  const missing = Array.from(new Set(blockNumbers)).filter(
    (b) => Number.isFinite(b) && !cache.has(b)
  );

  await Promise.all(missing.map((b) => getBlockTimestamp(b)));
};
