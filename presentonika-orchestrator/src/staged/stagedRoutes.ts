import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { getStagedToken } from "./stagedStore";

const isSafeStagedName = (name: string): boolean => {
  return !(name.includes("/") || name.includes("\\") || name.includes("..") || path.basename(name) !== name);
};

const tokensEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const registerStagedRoutes = (app: FastifyInstance, opts: { redis: Redis; stagedDirAbs: string }): void => {
  app.get<{ Params: { name: string }; Querystring: { t?: string } }>("/staged/:name", async (request, reply) => {
    const { name } = request.params;
    const token = request.query.t;

    if (!token) {
      return reply.status(400).send({ error: "missing_token" });
    }

    if (!isSafeStagedName(name)) {
      return reply.status(400).send({ error: "invalid_name" });
    }

    const expectedToken = await getStagedToken(opts.redis, name);
    if (!expectedToken) {
      return reply.status(404).send({ error: "not_found" });
    }

    if (!tokensEqual(expectedToken, token)) {
      return reply.status(403).send({ error: "forbidden" });
    }

    const absPath = path.resolve(opts.stagedDirAbs, name);

    if (!absPath.startsWith(path.resolve(opts.stagedDirAbs) + path.sep) && absPath !== path.resolve(opts.stagedDirAbs, name)) {
      return reply.status(400).send({ error: "invalid_name" });
    }

    try {
      await fs.promises.access(absPath);
    } catch {
      return reply.status(404).send({ error: "not_found" });
    }

    reply.header("Content-Type", "application/zip");
    reply.header("Cache-Control", "no-store");

    return reply.send(fs.createReadStream(absPath));
  });
};
