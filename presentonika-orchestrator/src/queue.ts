import dotenv from "dotenv";
import { Queue, QueueEvents } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis, { Redis } from "ioredis";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const queueName = process.env.QUEUE_NAME || "presentonika_jobs";

let queue: Queue | null = null;
let queueEvents: QueueEvents | null = null;
let queueRedisConnection: Redis | null = null;
let workerRedisConnection: Redis | null = null;

const createConnection = (forWorker: boolean): Redis =>
  new IORedis(redisUrl, {
    maxRetriesPerRequest: forWorker ? null : undefined,
  });

const asBullConnection = (redis: Redis): ConnectionOptions => redis as unknown as ConnectionOptions;

export const getQueueName = (): string => queueName;

export const getQueueRedisConnection = (): Redis => {
  if (!queueRedisConnection) {
    queueRedisConnection = createConnection(false);
  }

  return queueRedisConnection;
};

export const getWorkerRedisConnection = (): Redis => {
  if (!workerRedisConnection) {
    workerRedisConnection = createConnection(true);
  }

  return workerRedisConnection;
};

export const getQueue = (): Queue => {
  if (!queue) {
    queue = new Queue(queueName, {
      connection: asBullConnection(getQueueRedisConnection()),
    });
  }

  return queue;
};

export const getQueueEvents = (): QueueEvents => {
  if (!queueEvents) {
    queueEvents = new QueueEvents(queueName, {
      connection: asBullConnection(getWorkerRedisConnection()),
    });
  }

  return queueEvents;
};


export const getWorkerBullConnection = (): ConnectionOptions => asBullConnection(getWorkerRedisConnection());
