import { z } from "zod"
import type { Redis } from "ioredis"

const safeToken = z.string().trim().min(1).max(96).regex(/^[a-zA-Z0-9._:-]+$/)

export const operationalEventSchema = z.object({
  service: z.enum(["wordpress", "orchestrator", "editor"]),
  event: safeToken,
  level: z.enum(["debug", "info", "warning", "error", "critical"]).default("info"),
  requestId: safeToken.optional(),
  presentationId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
  stage: safeToken.optional(),
  errorCode: safeToken.optional(),
  durationMs: z.number().finite().nonnegative().max(86_400_000).optional(),
  queueAgeMs: z.number().finite().nonnegative().max(86_400_000).optional(),
  timestamp: z.string().datetime().optional(),
}).strict()

export type OperationalEvent = z.infer<typeof operationalEventSchema>

const shouldAlert = (event: OperationalEvent): boolean =>
  event.level === "critical"
  || event.event.includes("stuck")
  || event.event.includes("refund_pending")
  || (event.queueAgeMs ?? 0) >= Number.parseInt(process.env.QUEUE_AGE_ALERT_MS || "300000", 10)

export async function recordOperationalEvent(redis: Redis, event: OperationalEvent): Promise<void> {
  const normalized = operationalEventSchema.parse(event)
  const timestamp = normalized.timestamp || new Date().toISOString()
  const record = { ...normalized, timestamp }
  const serialized = JSON.stringify(record)
  const alert = shouldAlert(normalized)

  const pipeline = redis.pipeline()
  pipeline.hincrby("observability:counters", `${normalized.service}:${normalized.event}`, 1)
  pipeline.lpush("observability:recent", serialized)
  pipeline.ltrim("observability:recent", 0, 199)
  pipeline.expire("observability:recent", 30 * 24 * 60 * 60)
  if (alert) {
    pipeline.lpush("observability:alerts", serialized)
    pipeline.ltrim("observability:alerts", 0, 99)
    pipeline.expire("observability:alerts", 30 * 24 * 60 * 60)
  }
  await pipeline.exec()

  const lokiUrl = process.env.LOKI_PUSH_URL?.trim()
  if (!lokiUrl) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)
  try {
    const response = await fetch(lokiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        streams: [{
          stream: { service: normalized.service, level: normalized.level, event: normalized.event },
          values: [[String(BigInt(Date.now()) * 1_000_000n), serialized]],
        }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`LokiPushFailed:${response.status}`)
  } catch {
    await redis.hincrby("observability:counters", "orchestrator:loki_push_failed", 1)
  } finally {
    clearTimeout(timeout)
  }
}

export async function getOperationalStatus(redis: Redis) {
  const [counters, recent, alerts] = await Promise.all([
    redis.hgetall("observability:counters"),
    redis.lrange("observability:recent", 0, 49),
    redis.lrange("observability:alerts", 0, 49),
  ])
  const parse = (value: string) => {
    try { return JSON.parse(value) as unknown } catch { return null }
  }
  return {
    counters,
    recent: recent.map(parse).filter(Boolean),
    alerts: alerts.map(parse).filter(Boolean),
  }
}
