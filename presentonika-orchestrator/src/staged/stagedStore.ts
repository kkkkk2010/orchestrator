import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { Redis } from "ioredis";

const toStagedKey = (name: string): string => `staged:${name}`;

export const createStagedFile = async (params: {
  jobId: string;
  localZipPath: string;
  stagedDirAbs: string;
  ttlSeconds: number;
  redis: Redis;
}): Promise<{ name: string; token: string; absPath: string }> => {
  await fs.mkdir(params.stagedDirAbs, { recursive: true });

  const name = `${params.jobId}.out.zip`;
  const absPath = path.resolve(params.stagedDirAbs, name);
  await fs.copyFile(path.resolve(params.localZipPath), absPath);

  const token = crypto.randomBytes(16).toString("hex");
  await params.redis.set(
    toStagedKey(name),
    JSON.stringify({ token }),
    "EX",
    Math.max(1, params.ttlSeconds)
  );

  return { name, token, absPath };
};

export const buildStagedUrl = (params: { baseUrl: string; name: string; token: string }): string => {
  const normalizedBaseUrl = params.baseUrl.replace(/\/$/, "");
  return `${normalizedBaseUrl}/staged/${encodeURIComponent(params.name)}?t=${encodeURIComponent(params.token)}`;
};

export const getStagedToken = async (redis: Redis, name: string): Promise<string | null> => {
  const raw = await redis.get(toStagedKey(name));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
};

export const deleteStagedRecord = async (redis: Redis, name: string): Promise<void> => {
  await redis.del(toStagedKey(name));
};
