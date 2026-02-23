import path from "node:path";
import fs from "node:fs/promises";
import { logger } from "../logger";

const nowMs = (): number => Date.now();

const toNum = (value: number | bigint): number => (typeof value === "bigint" ? Number(value) : value);

const isOlderThanTtl = (mtimeMs: number | bigint, ttlMs: number): boolean => {
  return nowMs() - toNum(mtimeMs) > ttlMs;
};

const listDirEntries = async (dirPath: string): Promise<string[]> => {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
};

const safeStat = async (targetPath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> => {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
};


const hasJobLockFile = async (jobDirAbs: string): Promise<boolean> => {
  const lockStats = await safeStat(path.resolve(jobDirAbs, ".lock"));
  return Boolean(lockStats && lockStats.isFile());
};

const safeRm = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    logger.warn({ err: error, targetPath }, "cleanup item delete failed");
    return false;
  }
};

const cleanupTmpJobs = async (tmpDirAbs: string, artifactTtlMs: number): Promise<number> => {
  let deleted = 0;
  const names = await listDirEntries(tmpDirAbs);

  for (const name of names) {
    if (name === "mock-wp") {
      continue;
    }

    const absPath = path.resolve(tmpDirAbs, name);
    const stats = await safeStat(absPath);
    if (!stats || !stats.isDirectory()) {
      continue;
    }

    const looksLikeJobDir = name.startsWith("p_");
    if (looksLikeJobDir && await hasJobLockFile(absPath)) {
      continue;
    }

    if (!isOlderThanTtl(stats.mtimeMs, artifactTtlMs)) {
      continue;
    }

    if (await safeRm(absPath)) {
      deleted += 1;
    }
  }

  return deleted;
};

const cleanupMockWp = async (mockWpDirAbs: string, mockWpTtlMs: number): Promise<number> => {
  let deleted = 0;
  const names = await listDirEntries(mockWpDirAbs);

  for (const name of names) {
    const absPath = path.resolve(mockWpDirAbs, name);
    const stats = await safeStat(absPath);
    if (!stats || !stats.isDirectory()) {
      continue;
    }

    if (!isOlderThanTtl(stats.mtimeMs, mockWpTtlMs)) {
      continue;
    }

    if (await safeRm(absPath)) {
      deleted += 1;
    }
  }

  return deleted;
};

const cleanupOutDir = async (outDirAbs: string, artifactTtlMs: number): Promise<number> => {
  let deleted = 0;
  const names = await listDirEntries(outDirAbs);

  for (const name of names) {
    if (!name.endsWith(".out.zip")) {
      continue;
    }

    const absPath = path.resolve(outDirAbs, name);
    const stats = await safeStat(absPath);
    if (!stats || !stats.isFile()) {
      continue;
    }

    if (!isOlderThanTtl(stats.mtimeMs, artifactTtlMs)) {
      continue;
    }

    if (await safeRm(absPath)) {
      deleted += 1;
    }
  }

  return deleted;
};

const cleanupStagedDir = async (stagedDirAbs: string, artifactTtlMs: number): Promise<number> => {
  let deleted = 0;
  const names = await listDirEntries(stagedDirAbs);

  for (const name of names) {
    const absPath = path.resolve(stagedDirAbs, name);
    const stats = await safeStat(absPath);
    if (!stats || !stats.isFile()) {
      continue;
    }

    if (!isOlderThanTtl(stats.mtimeMs, artifactTtlMs)) {
      continue;
    }

    if (await safeRm(absPath)) {
      deleted += 1;
    }
  }

  return deleted;
};

export const startCleanupService = (opts?: {
  tmpDirAbs?: string;
  outDirAbs?: string;
  stagedDirAbs?: string;
  mockWpDirAbs?: string;
}): (() => void) => {
  const enabled = process.env.ENABLE_CLEANUP === "true";
  if (!enabled) {
    logger.info({ cleanupEnabled: false }, "cleanup service disabled");
    return () => undefined;
  }

  const artifactTtlSeconds = Number.parseInt(process.env.ARTIFACT_TTL_SECONDS || "21600", 10);
  const cleanupIntervalSeconds = Number.parseInt(process.env.CLEANUP_INTERVAL_SECONDS || "600", 10);
  const mockWpTtlSeconds = Number.parseInt(process.env.MOCK_WP_TTL_SECONDS || String(artifactTtlSeconds), 10);
  const artifactTtlMs = artifactTtlSeconds * 1000;
  const mockWpTtlMs = mockWpTtlSeconds * 1000;

  const tmpDirAbs = path.resolve(opts?.tmpDirAbs || ".tmp");
  const outDirAbs = path.resolve(opts?.outDirAbs || "out");
  const stagedDirAbs = path.resolve(opts?.stagedDirAbs || ".staged");
  const mockWpDirAbs = path.resolve(opts?.mockWpDirAbs || path.join(tmpDirAbs, "mock-wp"));

  const runCleanup = async (): Promise<void> => {
    try {
      const deletedTmpDirs = await cleanupTmpJobs(tmpDirAbs, artifactTtlMs);
      const deletedMockWpDirs = await cleanupMockWp(mockWpDirAbs, mockWpTtlMs);
      const deletedOutZips = await cleanupOutDir(outDirAbs, artifactTtlMs);
      const deletedStagedFiles = await cleanupStagedDir(stagedDirAbs, artifactTtlMs);

      logger.info(
        {
          deletedTmpDirs,
          deletedMockWpDirs,
          deletedOutZips,
          deletedStagedFiles,
          artifactTtlSeconds,
          artifactTtlMs,
          mockWpTtlSeconds,
          mockWpTtlMs,
          cleanupIntervalSeconds,
        },
        "cleanup run completed"
      );
    } catch (error) {
      logger.warn({ err: error }, "cleanup run failed");
    }
  };

  const intervalMs = Math.max(1, cleanupIntervalSeconds) * 1000;
  const interval = setInterval(() => {
    void runCleanup();
  }, intervalMs);

  void runCleanup();

  logger.info(
    { intervalMs, artifactTtlSeconds, artifactTtlMs, mockWpTtlSeconds, mockWpTtlMs, tmpDirAbs, outDirAbs, stagedDirAbs, mockWpDirAbs },
    "cleanup service started"
  );

  return (): void => {
    clearInterval(interval);
  };
};
