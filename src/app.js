import Fastify from "fastify";
import multipart from "@fastify/multipart";

import { buildAuthPreHandler } from "./auth.js";
import { startCleanupScheduler } from "./cleanup.js";
import { AppError, toErrorResponse } from "./errors.js";
import { IdempotencyStore } from "./idempotency-store.js";
import { RuntimeMetrics } from "./metrics.js";
import { registerUploadRoutes } from "./routes/upload.js";
import { ensureStorageReady } from "./storage.js";

export async function buildServer(config) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 32,
      parts: 30,
      fileSize: config.maxFileSizeBytes,
    },
    throwFileSizeLimit: true,
  });

  await ensureStorageReady(config);

  const idempotencyStore = new IdempotencyStore({
    filePath: config.idempotencyFilePath,
    logger: app.log,
  });
  await idempotencyStore.init();

  const metrics = new RuntimeMetrics({ windowSize: config.metricsWindowSize });
  const authPreHandler = buildAuthPreHandler(config);

  await registerUploadRoutes(app, {
    config,
    authPreHandler,
    idempotencyStore,
    metrics,
  });

  app.get("/", async () => {
    return {
      service: config.appName,
      status: "ok",
      docs: "See docs/upload-api-contract.md in repository.",
    };
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      code: -1,
      message: `Route not found: ${request.method} ${request.url}`,
      errorCode: "NOT_FOUND",
      retryable: false,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    let normalizedError = error;

    if (error?.code === "FST_REQ_FILE_TOO_LARGE") {
      normalizedError = new AppError({
        statusCode: 413,
        errorCode: "FILE_TOO_LARGE",
        message: "File exceeds size limit.",
        retryable: false,
      });
    }

    if (error?.code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
      normalizedError = new AppError({
        statusCode: 400,
        errorCode: "INVALID_CONTENT_TYPE",
        message: "Request must be multipart/form-data.",
        retryable: false,
      });
    }

    const { statusCode, payload } = toErrorResponse(normalizedError);

    request.log.error(
      {
        err: error,
        statusCode,
        errorCode: payload.errorCode,
      },
      "Request failed",
    );

    reply.code(statusCode).send(payload);
  });

  const stopCleanupScheduler = startCleanupScheduler({
    config,
    logger: app.log,
  });

  app.addHook("onClose", async () => {
    stopCleanupScheduler();
  });

  return app;
}
