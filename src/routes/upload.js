import path from "node:path";

import { AppError } from "../errors.js";
import {
  assertDiskFreeSpace,
  buildStoragePaths,
  moveStagingToFinal,
  normalizeSessionName,
  normalizeTaskId,
  safeDeleteFile,
  validateZipPart,
  writePartToStaging,
} from "../storage.js";
import { extractTaskIdHeader } from "../auth.js";

export async function registerUploadRoutes(fastify, options) {
  const { config, authPreHandler, idempotencyStore, metrics } = options;
  const inFlightTaskIds = new Set();

  fastify.get("/healthz", async () => {
    return {
      status: "ok",
      service: config.appName,
      time: new Date().toISOString(),
    };
  });

  fastify.get("/metrics", async () => {
    return {
      code: 0,
      message: "ok",
      data: metrics.snapshot(),
    };
  });

  fastify.post(
    "/api/v1/slam/upload",
    {
      preHandler: [authPreHandler],
    },
    async (request, reply) => {
      const startedAt = Date.now();

      if (!request.isMultipart()) {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_CONTENT_TYPE",
          message: "Request must be multipart/form-data.",
          retryable: false,
        });
      }

      const taskId = normalizeTaskId(extractTaskIdHeader(request));

      const idempotentRecord = idempotencyStore.get(taskId);
      if (idempotentRecord?.status === "success") {
        const durationMs = Date.now() - startedAt;
        metrics.recordSuccess({ durationMs, uploadedBytes: 0 });
        return reply.code(200).send({
          code: 0,
          message: "Task already processed (idempotent hit).",
          data: {
            ...idempotentRecord,
            idempotent: true,
            durationMs,
          },
        });
      }

      if (inFlightTaskIds.has(taskId)) {
        throw new AppError({
          statusCode: 409,
          errorCode: "TASK_IN_PROGRESS",
          message: "Task is in progress. Retry later.",
          retryable: true,
        });
      }

      inFlightTaskIds.add(taskId);

      let stagingPath = "";

      try {
        let uploadedBytes = 0;
        let uploaded = false;
        let sessionNameRaw = "";
        let sessionPath = "";
        let originalFileName = "";
        let mimeType = "";

        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (uploaded) {
              part.file.resume();
              throw new AppError({
                statusCode: 400,
                errorCode: "MULTIPLE_FILES_NOT_ALLOWED",
                message: "Only one ZIP file is allowed.",
                retryable: false,
              });
            }

            validateZipPart(part, config);
            await assertDiskFreeSpace(config);

            stagingPath = path.join(
              config.stagingDir,
              `${taskId}_${Date.now()}_${Math.round(Math.random() * 1e6)}.part`,
            );

            uploadedBytes = await writePartToStaging(part, stagingPath);
            uploaded = true;
            originalFileName = part.filename;
            mimeType = part.mimetype;
            continue;
          }

          if (part.fieldname === "sessionName") {
            sessionNameRaw = String(part.value ?? "").trim();
          }
          if (part.fieldname === "sessionPath") {
            sessionPath = String(part.value ?? "").trim();
          }
        }

        if (!uploaded) {
          throw new AppError({
            statusCode: 400,
            errorCode: "MISSING_FILE",
            message: "Missing field file.",
            retryable: false,
          });
        }

        const sessionName = normalizeSessionName(sessionNameRaw);

        const { finalDir, finalPath, fileName, dateSegment } =
          buildStoragePaths({
            config,
            taskId,
            sessionName,
          });

        await moveStagingToFinal(stagingPath, finalDir, finalPath);
        stagingPath = "";

        const uploadedAt = new Date().toISOString();
        const record = {
          taskId,
          sessionName,
          sessionPath: sessionPath || null,
          dateSegment,
          fileName,
          storedPath: finalPath,
          uploadedBytes,
          mimeType,
          originalFileName,
          uploadedAt,
        };

        await idempotencyStore.markSuccess(taskId, record);

        const durationMs = Date.now() - startedAt;
        metrics.recordSuccess({ durationMs, uploadedBytes });

        request.log.info(
          {
            taskId,
            sessionName,
            uploadedBytes,
            durationMs,
            storedPath: finalPath,
          },
          "Upload succeeded",
        );

        return reply.code(200).send({
          code: 0,
          message: "Upload succeeded.",
          data: {
            ...record,
            idempotent: false,
            durationMs,
          },
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        metrics.recordFailure({ durationMs });

        if (stagingPath) {
          try {
            await safeDeleteFile(stagingPath);
          } catch (cleanupError) {
            request.log.warn(
              { err: cleanupError, stagingPath },
              "Failed to cleanup staging file.",
            );
          }
        }

        throw error;
      } finally {
        inFlightTaskIds.delete(taskId);
      }
    },
  );
}
