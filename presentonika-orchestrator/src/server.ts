import "dotenv/config";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { closeQueueResources, getQueue, getQueueRedisConnection, getWorkerHeartbeatKey } from "./queue";
import { createJobSchema } from "./schema";
import { registerStagedRoutes } from "./staged/stagedRoutes";
import { startCleanupService } from "./cleanup/cleanupService";
import { buildPlanForUi, createPlanRequestSchema, generateDeckPlan } from "./deckPlan";
import { getOperationalStatus, operationalEventSchema, recordOperationalEvent } from "./observability";

const port = Number(process.env.PORT || 8080);
const mockWpEnabled = process.env.ENABLE_MOCK_WP === "true";
const stagedServerEnabled = process.env.STAGED_ENABLE_SERVER !== "false";
const stagedDirAbs = path.resolve(process.env.STAGED_DIR || ".staged");
const ORCHESTRATOR_PUBLIC_KEY = process.env.PRESENTONIKA_ORCHESTRATOR_KEY || process.env.ORCHESTRATOR_PUBLIC_KEY || "";
const JOBS_RATE_LIMIT_MAX = Number.parseInt(process.env.JOBS_RATE_LIMIT_MAX || "30", 10);
const JOBS_RATE_LIMIT_WINDOW_SECONDS = Number.parseInt(process.env.JOBS_RATE_LIMIT_WINDOW_SECONDS || "300", 10);
const PLANS_RATE_LIMIT_MAX = Number.parseInt(process.env.PLANS_RATE_LIMIT_MAX || "20", 10);
const PLANS_RATE_LIMIT_WINDOW_SECONDS = Number.parseInt(process.env.PLANS_RATE_LIMIT_WINDOW_SECONDS || "300", 10);
const PLANS_CONCURRENCY_MAX = Number.parseInt(process.env.PLANS_CONCURRENCY_MAX || "2", 10);
const PLANS_SLOT_TTL_SECONDS = Number.parseInt(process.env.PLANS_SLOT_TTL_SECONDS || "90", 10);
const REQUIRE_WORKER_READY = process.env.REQUIRE_WORKER_READY !== "false";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-orchestrator-key",
        "*.saveToken",
        "*.token",
        "*.secret",
        "*.email",
        "*.topic",
        "*.prompt",
      ],
      censor: "[redacted]",
    },
  },
  trustProxy: TRUST_PROXY ? "127.0.0.1" : false,
  bodyLimit: 2 * 1024 * 1024,
  disableRequestLogging: true,
  genReqId: (request) => {
    const supplied = String(request.headers["x-request-id"] || "").trim();
    return /^[a-zA-Z0-9._:-]{8,96}$/.test(supplied) ? supplied : crypto.randomUUID();
  },
});

app.addHook("onRequest", async (request, reply) => {
  reply.header("X-Request-Id", request.id);
});

app.addHook("onResponse", async (request, reply) => {
  request.log.info({
    method: request.method,
    route: request.routeOptions.url,
    statusCode: reply.statusCode,
    responseTimeMs: Math.round(reply.elapsedTime),
  }, "request completed");
});

const stopCleanupService = startCleanupService({
  tmpDirAbs: path.resolve(".tmp"),
  outDirAbs: path.resolve("out"),
  stagedDirAbs,
  mockWpDirAbs: path.resolve(".tmp", "mock-wp"),
});

void app.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 1,
    fields: 50,
  },
});

if (stagedServerEnabled) {
  registerStagedRoutes(app, {
    redis: getQueueRedisConnection(),
    stagedDirAbs,
  });
}

const requirePublicKey = (request: { headers: Record<string, unknown>; ip: string }, reply: { status: (code: number) => { send: (payload: unknown) => unknown }; }): boolean => {
  const raw = request.headers["x-orchestrator-key"];
  const headerValue = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");

  const supplied = Buffer.from(headerValue);
  const expected = Buffer.from(ORCHESTRATOR_PUBLIC_KEY);
  const authorized = expected.length > 0 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);

  if (!authorized) {
    app.log.warn({ ip: request.ip, path: "auth", hasKey: Boolean(headerValue) }, "unauthorized orchestrator api request");
    void reply.status(401).send({ error: "unauthorized" });
    return false;
  }

  return true;
};

const checkRateLimit = async (
  scope: string,
  subject: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> => {
  const redis = getQueueRedisConnection();
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = Math.max(1, windowSeconds);
  const windowStart = Math.floor(nowSec / windowSec) * windowSec;
  const key = `rl:${scope}:${subject}:${windowStart}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }

  const retryAfterSec = Math.max(1, windowSec - (nowSec % windowSec));
  return {
    allowed: count <= Math.max(1, maxRequests),
    retryAfterSec,
  };
};

const acquirePlansSlot = async (): Promise<boolean> => {
  const redis = getQueueRedisConnection();
  const key = "concurrency:plans";
  const result = await redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[2]); end; if n>tonumber(ARGV[1]) then redis.call('DECR',KEYS[1]); return 0; end; return 1;",
    1,
    key,
    String(Math.max(1, PLANS_CONCURRENCY_MAX)),
    String(Math.max(30, PLANS_SLOT_TTL_SECONDS)),
  );
  return Number(result) === 1;
};

const releasePlansSlot = async (): Promise<void> => {
  const redis = getQueueRedisConnection();
  const key = "concurrency:plans";
  await redis.eval(
    "local n=redis.call('GET',KEYS[1]); if not n then return 0; end; n=redis.call('DECR',KEYS[1]); if n<=0 then redis.call('DEL',KEYS[1]); end; return n;",
    1,
    key,
  );
};

app.get("/health", async () => ({
  ok: true,
  service: "orchestrator",
  ts: new Date().toISOString(),
}));

app.get("/ready", async (_request, reply) => {
  try {
    const redis = getQueueRedisConnection();
    await redis.ping();
    const workerHeartbeat = REQUIRE_WORKER_READY ? await redis.get(getWorkerHeartbeatKey()) : "not-required";
    if (REQUIRE_WORKER_READY && !workerHeartbeat) {
      return reply.status(503).send({ ok: false, redis: true, worker: false });
    }
    return { ok: true, redis: true, worker: true };
  } catch (error) {
    app.log.warn({ err: error }, "readiness check failed");
    return reply.status(503).send({ ok: false, redis: false, worker: false });
  }
});

app.post("/observability/events", async (request, reply) => {
  if (!requirePublicKey(request, reply)) return;
  const parsed = operationalEventSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "validation_error" });
  try {
    await recordOperationalEvent(getQueueRedisConnection(), parsed.data);
    return reply.status(202).send({ ok: true });
  } catch (error) {
    request.log.warn({ err: error, event: parsed.data.event }, "operational event ingest failed");
    return reply.status(503).send({ error: "observability_unavailable" });
  }
});

app.get("/admin/status", async (request, reply) => {
  if (!requirePublicKey(request, reply)) return;
  const queue = getQueue();
  const [counts, waiting, operational, workerHeartbeat] = await Promise.all([
    queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
    queue.getJobs(["waiting"], 0, 0, true),
    getOperationalStatus(getQueueRedisConnection()),
    getQueueRedisConnection().get(getWorkerHeartbeatKey()),
  ]);
  const oldest = waiting[0];
  return {
    ok: true,
    queue: {
      counts,
      oldestWaitingAgeMs: oldest?.timestamp ? Math.max(0, Date.now() - oldest.timestamp) : 0,
    },
    worker: { heartbeat: workerHeartbeat ? JSON.parse(workerHeartbeat) : null },
    observability: operational,
  };
});

app.post("/plans", async (request, reply) => {
  if (!requirePublicKey(request, reply)) {
    return;
  }

  const parsed = createPlanRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten(),
    });
  }

  const ip = request.ip || "unknown";
  const rate = await checkRateLimit(
    "plans",
    ip,
    PLANS_RATE_LIMIT_MAX,
    PLANS_RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!rate.allowed) {
    request.log.warn({ ip, retryAfterSec: rate.retryAfterSec }, "plans rate limit exceeded");
    return reply.header("Retry-After", String(rate.retryAfterSec)).status(429).send({ error: "rate_limited" });
  }

  const slotAcquired = await acquirePlansSlot();
  if (!slotAcquired) {
    request.log.warn({ ip }, "plans concurrency limit exceeded");
    return reply.header("Retry-After", "5").status(429).send({ error: "too_many_active_plans" });
  }

  try {
    const result = await generateDeckPlan(parsed.data);
    request.log.info({ source: result.diagnostics.source, llmUsed: result.diagnostics.llmUsed }, "deck plan generated");
    return {
      ok: true,
      deckPlan: result.deckPlan,
      planForUi: buildPlanForUi(result.deckPlan, result.diagnostics.planDiagnostics?.warnings || []),
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    request.log.warn({ err: error }, "deck plan generation failed");
    return reply.status(400).send({
      ok: false,
      error: "plan_generation_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await releasePlansSlot().catch((error) => request.log.error({ err: error }, "failed to release plans slot"));
  }
});

app.post("/jobs", async (request, reply) => {
  if (!requirePublicKey(request, reply)) {
    return;
  }

  const ip = request.ip || "unknown";
  const rate = await checkRateLimit("jobs", ip, JOBS_RATE_LIMIT_MAX, JOBS_RATE_LIMIT_WINDOW_SECONDS);
  if (!rate.allowed) {
    request.log.warn({ ip, retryAfterSec: rate.retryAfterSec }, "jobs rate limit exceeded");
    return reply.header("Retry-After", String(rate.retryAfterSec)).status(429).send({ error: "rate_limited" });
  }

  const parsed = createJobSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: "validation_error",
      details: parsed.error.flatten(),
    });
  }

  const payload = parsed.data;
  if (process.env.NODE_ENV === "production" && payload.debug && process.env.ALLOW_DEBUG_FILLS !== "true") {
    return reply.status(400).send({ error: "debug_fills_disabled" });
  }
  const jobId = `p_${payload.presentationId}_${Date.now()}`;

  await getQueue().add("generate", payload, {
    jobId,
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });

  request.log.info({ jobId, ip }, "job queued");
  await recordOperationalEvent(getQueueRedisConnection(), {
    service: "orchestrator",
    event: "generation.queued",
    level: "info",
    requestId: payload.requestId || request.id,
    presentationId: payload.presentationId,
  }).catch((error) => request.log.warn({ err: error }, "queue metric write failed"));

  return {
    jobId,
    status: "queued",
  };
});

app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
  if (!requirePublicKey(request, reply)) {
    return;
  }

  const { id } = request.params;
  const job = await getQueue().getJob(id);

  if (!job) {
    return reply.status(404).send({ error: "not_found" });
  }

  const state = await job.getState();
  const rawProgress = job.progress;
  const progress = typeof rawProgress === "number" ? rawProgress : 0;

  const returnValue =
    state === "completed"
      ? ((job as { returnvalue?: unknown; returnValue?: unknown }).returnvalue ??
          (job as { returnvalue?: unknown; returnValue?: unknown }).returnValue ??
          null)
      : null;

  return {
    jobId: job.id,
    state,
    progress,
    createdAt: job.timestamp ?? null,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    failedReason: job.failedReason || null,
    returnValue,
  };
});

if (mockWpEnabled) {
  app.post("/mock/wp-save-outzip", async (request, reply) => {
    const parts = request.parts();

    let presentationId = "";
    let saveToken = "";
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "file") {
          continue;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fileBuffer = Buffer.concat(chunks);
        continue;
      }

      if (part.fieldname === "presentationId") {
        presentationId = String(part.value ?? "");
      }

      if (part.fieldname === "saveToken") {
        saveToken = String(part.value ?? "");
      }
    }

    if (!presentationId || !saveToken || !fileBuffer) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_multipart_payload",
      });
    }

    const storedPath = path.resolve(".tmp", "mock-wp", presentationId, "received.out.zip");
    await fs.mkdir(path.dirname(storedPath), { recursive: true });
    await fs.writeFile(storedPath, fileBuffer);

    return {
      ok: true,
      presentationId,
      bytes: fileBuffer.byteLength,
      storedPath: path.relative(process.cwd(), storedPath),
    };
  });

  app.post<{ Body: { outZipUrl?: string } }>("/mock/wp-save-outzip-from-url", async (request, reply) => {
    const outZipUrl = request.body?.outZipUrl;
    const presentationId = String(request.headers["x-presentation-id"] ?? "");
    const saveToken = String(request.headers["x-save-token"] ?? "");

    if (!outZipUrl || !presentationId || !saveToken) {
      return reply.status(400).send({ ok: false, error: "invalid_request" });
    }

    const response = await fetch(outZipUrl);
    if (!response.ok) {
      return reply.status(400).send({ ok: false, error: `download_failed_${response.status}` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const storedPath = path.resolve(".tmp", "mock-wp", presentationId, "received.out.zip");
    await fs.mkdir(path.dirname(storedPath), { recursive: true });
    await fs.writeFile(storedPath, buffer);

    return {
      ok: true,
      presentationId,
      bytes: buffer.byteLength,
      storedPath: path.relative(process.cwd(), storedPath),
    };
  });
}

const start = async (): Promise<void> => {
  try {
    if (process.env.NODE_ENV === "production" && ORCHESTRATOR_PUBLIC_KEY.length < 32) {
      app.log.warn("PRESENTONIKA_ORCHESTRATOR_KEY should be rotated to at least 32 characters");
    }
    await app.listen({ host: "0.0.0.0", port });
  } catch (error) {
    app.log.error(error, "failed to start server");
    process.exit(1);
  }
};

void start();

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down orchestrator api");
  stopCleanupService();
  await app.close().catch((error) => app.log.error({ err: error }, "api close failed"));
  await closeQueueResources();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
