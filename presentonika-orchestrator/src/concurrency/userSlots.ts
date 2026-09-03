import type { Redis } from "ioredis";

export type UserSlotOptions = {
  limit: number;
  ttlSeconds: number;
  waitMs?: number;
  onWait?: () => void;
};

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function acquireUserSlot(
  redis: Redis,
  userId: number,
  token: string,
  options: UserSlotOptions,
): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;

  const key = `concurrency:user:${userId}`;
  const limit = Math.max(1, Math.floor(options.limit));
  const ttlSeconds = Math.max(300, Math.floor(options.ttlSeconds));
  const waitMs = Math.max(10, Math.floor(options.waitMs ?? 500));
  let waitingReported = false;

  while (true) {
    const now = Date.now();
    const acquired = await redis.eval(
      "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) then return 0; end; redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); redis.call('EXPIRE',KEYS[1],ARGV[5]); return 1;",
      1,
      key,
      String(now),
      String(limit),
      String(now + ttlSeconds * 1000),
      token,
      String(ttlSeconds),
    );
    if (Number(acquired) === 1) return true;
    if (!waitingReported) {
      options.onWait?.();
      waitingReported = true;
    }
    await pause(waitMs);
  }
}

export async function releaseUserSlot(
  redis: Redis,
  userId: number,
  token: string,
  acquired: boolean,
): Promise<void> {
  if (!acquired || !Number.isInteger(userId) || userId <= 0) return;
  await redis.zrem(`concurrency:user:${userId}`, token);
}
