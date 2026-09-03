import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

export const logger = pino({
  level,
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
});
