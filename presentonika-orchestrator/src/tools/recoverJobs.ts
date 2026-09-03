import "dotenv/config"
import { closeQueueResources, getQueue } from "../queue"

const args = new Set(process.argv.slice(2))
const apply = args.has("--apply")
const jobIdArg = process.argv.find((value) => value.startsWith("--job-id="))
const requestedJobId = jobIdArg?.slice("--job-id=".length) || ""
const stuckArg = process.argv.find((value) => value.startsWith("--stuck-ms="))
const stuckMs = Math.max(60_000, Number.parseInt(stuckArg?.slice("--stuck-ms=".length) || "900000", 10))

const run = async (): Promise<void> => {
  const queue = getQueue()
  const [active, waiting, delayed, failed] = await Promise.all([
    queue.getJobs(["active"], 0, 999, true),
    queue.getJobs(["waiting"], 0, 999, true),
    queue.getJobs(["delayed"], 0, 999, true),
    queue.getJobs(["failed"], 0, 999, true),
  ])
  const now = Date.now()
  const stuck = active.filter((job) => now - (job.processedOn || job.timestamp) >= stuckMs)
  const report = {
    mode: apply ? "apply" : "dry-run",
    counts: { active: active.length, waiting: waiting.length, delayed: delayed.length, failed: failed.length },
    stuck: stuck.map((job) => ({
      jobId: job.id,
      ageMs: now - (job.processedOn || job.timestamp),
      presentationId: job.data?.presentationId,
      recovery: "bullmq-stalled-checker",
    })),
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (!apply) return
  if (!requestedJobId) throw new Error("--apply requires an explicit --job-id=<id>")
  const job = failed.find((candidate) => String(candidate.id) === requestedJobId)
  if (!job) throw new Error("Only an explicitly selected failed job can be retried; active jobs are recovered by BullMQ")
  await job.retry("failed")
  process.stdout.write(`${JSON.stringify({ retried: requestedJobId })}\n`)
}

void run()
  .finally(() => closeQueueResources())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })

