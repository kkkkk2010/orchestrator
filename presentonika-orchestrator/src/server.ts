import dotenv from "dotenv";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import path from "node:path";
import fs from "node:fs/promises";
import { getQueue } from "./queue";
import { createJobSchema } from "./schema";
import { logger } from "./logger";

dotenv.config();

const port = Number(process.env.PORT || 8080);
const mockWpEnabled = process.env.ENABLE_MOCK_WP === "true";
const app = Fastify({ logger });

void app.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 1,
    fields: 50,
  },
});

app.get("/health", async () => ({
  ok: true,
  service: "orchestrator",
  ts: new Date().toISOString(),
}));

app.post("/jobs", async (request, reply) => {
  const parsed = createJobSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: "validation_error",
      details: parsed.error.flatten(),
    });
  }

  const payload = parsed.data;
  const jobId = `p_${payload.presentationId}_${Date.now()}`;

  await getQueue().add("generate", payload, {
    jobId,
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });

  request.log.info({ jobId }, "job queued");

  return {
    jobId,
    status: "queued",
  };
});

app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
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
}

const start = async (): Promise<void> => {
  try {
    await app.listen({ host: "0.0.0.0", port });
  } catch (error) {
    app.log.error(error, "failed to start server");
    process.exit(1);
  }
};

void start();
