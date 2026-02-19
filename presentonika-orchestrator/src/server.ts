import dotenv from "dotenv";
import Fastify from "fastify";
import { getQueue } from "./queue";
import { createJobSchema } from "./schema";
import { logger } from "./logger";

dotenv.config();

const port = Number(process.env.PORT || 8080);
const app = Fastify({ logger });

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
    removeOnComplete: true,
    removeOnFail: false,
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

  return {
    jobId: job.id,
    state,
    progress,
    createdAt: job.timestamp ?? null,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    failedReason: job.failedReason || null,
  };
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ host: "0.0.0.0", port });
  } catch (error) {
    app.log.error(error, "failed to start server");
    process.exit(1);
  }
};

void start();
