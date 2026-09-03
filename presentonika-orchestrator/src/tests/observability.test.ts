import assert from "node:assert/strict"
import { operationalEventSchema } from "../observability"

export const runObservabilityTests = (): void => {
  assert.equal(operationalEventSchema.safeParse({
    service: "wordpress",
    event: "generation.failed",
    level: "error",
    requestId: "request-12345678",
    presentationId: 42,
    errorCode: "worker_failed",
  }).success, true)

  assert.equal(operationalEventSchema.safeParse({
    service: "editor",
    event: "bridge.save_failed",
    level: "error",
    email: "must-not-be-accepted@example.com",
  }).success, false)

  assert.equal(operationalEventSchema.safeParse({
    service: "orchestrator",
    event: "generation.failed",
    level: "error",
    prompt: "raw prompt must not be accepted",
  }).success, false)
}

