import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import checkDiskSpaceModule from "check-disk-space";

import { AppError } from "./errors.js";

const checkDiskSpace = checkDiskSpaceModule.default ?? checkDiskSpaceModule;

const SESSION_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function ensureStorageReady(config) {
  await fs.mkdir(config.uploadRootDir, { recursive: true });
  await fs.mkdir(config.stagingDir, { recursive: true });
}

export function normalizeTaskId(taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new AppError({
      statusCode: 400,
      errorCode: "MISSING_TASK_ID",
      message: "Missing header X-Upload-Task-Id.",
      retryable: false,
    });
  }

  const trimmed = taskId.trim();
  if (!trimmed || trimmed.length > 128 || !TASK_ID_PATTERN.test(trimmed)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_TASK_ID",
      message: "Invalid X-Upload-Task-Id format.",
      retryable: false,
    });
  }

  return trimmed;
}

export function normalizeSessionName(sessionName) {
  if (!sessionName || typeof sessionName !== "string") {
    throw new AppError({
      statusCode: 400,
      errorCode: "MISSING_SESSION_NAME",
      message: "Missing field sessionName.",
      retryable: false,
    });
  }

  const trimmed = sessionName.trim();
  if (!trimmed || trimmed.length > 200 || !SESSION_NAME_PATTERN.test(trimmed)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_SESSION_NAME",
      message:
        "Invalid sessionName. Allowed: letters, numbers, dot, underscore, dash.",
      retryable: false,
    });
  }

  if (trimmed === "." || trimmed === "..") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_SESSION_NAME",
      message: "Invalid sessionName.",
      retryable: false,
    });
  }

  return trimmed;
}

export async function assertDiskFreeSpace(config) {
  const result = await checkDiskSpace(config.uploadRootDir);
  if (result.free < config.diskFreeThresholdBytes) {
    throw new AppError({
      statusCode: 507,
      errorCode: "INSUFFICIENT_STORAGE",
      message: "Insufficient free disk space on server.",
      retryable: true,
      details: {
        freeBytes: result.free,
        thresholdBytes: config.diskFreeThresholdBytes,
      },
    });
  }
}

export function validateZipPart(part, config) {
  if (part.fieldname !== "file") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_FILE_FIELD",
      message: "File field name must be file.",
      retryable: false,
    });
  }

  const originalName = part.filename ?? "";
  if (!originalName.toLowerCase().endsWith(".zip")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_FILE_EXTENSION",
      message: "Only ZIP files are allowed.",
      retryable: false,
    });
  }

  if (!config.allowedMimeTypes.has(part.mimetype)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_CONTENT_TYPE",
      message: `Unsupported MIME type: ${part.mimetype}`,
      retryable: false,
    });
  }
}

export function buildStoragePaths({
  config,
  taskId,
  sessionName,
  now = new Date(),
}) {
  const dateSegment = now.toISOString().slice(0, 10);
  const fileName = `${taskId}_${Date.now()}.zip`;
  const finalDir = path.join(config.uploadRootDir, dateSegment, sessionName);
  const finalPath = path.join(finalDir, fileName);
  const stagingPath = path.join(
    config.stagingDir,
    `${taskId}_${Date.now()}_${Math.round(Math.random() * 1e6)}.part`,
  );

  return {
    dateSegment,
    fileName,
    finalDir,
    finalPath,
    stagingPath,
  };
}

export async function writePartToStaging(part, stagingPath) {
  await fs.mkdir(path.dirname(stagingPath), { recursive: true });

  let uploadedBytes = 0;
  part.file.on("data", (chunk) => {
    uploadedBytes += chunk.length;
  });

  const output = createWriteStream(stagingPath, { flags: "wx" });
  await pipeline(part.file, output);

  if (part.file.truncated) {
    await safeDeleteFile(stagingPath);
    throw new AppError({
      statusCode: 413,
      errorCode: "FILE_TOO_LARGE",
      message: "File exceeds size limit.",
      retryable: false,
    });
  }

  if (uploadedBytes <= 0) {
    await safeDeleteFile(stagingPath);
    throw new AppError({
      statusCode: 400,
      errorCode: "EMPTY_FILE",
      message: "Uploaded file is empty.",
      retryable: false,
    });
  }

  return uploadedBytes;
}

export async function moveStagingToFinal(stagingPath, finalDir, finalPath) {
  await fs.mkdir(finalDir, { recursive: true });
  await fs.rename(stagingPath, finalPath);
}

export async function safeDeleteFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}
