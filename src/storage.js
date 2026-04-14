import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import checkDiskSpaceModule from "check-disk-space";
import unzipper from "unzipper";

import { AppError } from "./errors.js";

const checkDiskSpace = checkDiskSpaceModule.default ?? checkDiskSpaceModule;

const SESSION_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const DATASET_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const SESSION_TIME_PATTERN = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;
const SCENE_ROOT_ALLOWED_FILES = new Set([
  "calibration.json",
  "data.jsonl",
  "data.mov",
  "metadata.json",
  "upload_context.json",
]);
const SCENE_ROOT_IGNORED_FILES = new Set(["data2.mov"]);

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

export function normalizeDatasetSegment(
  value,
  { fieldName, defaultValue = "" } = {},
) {
  const candidate = (value == null ? defaultValue : value).trim();
  if (
    !candidate ||
    candidate === "." ||
    candidate === ".." ||
    !DATASET_SEGMENT_PATTERN.test(candidate)
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DATASET_SEGMENT",
      message: `Invalid ${fieldName}. Allowed: letters, numbers, dot, underscore, dash.`,
      retryable: false,
    });
  }

  return candidate;
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
  captureName,
  sceneName,
  seqName,
  now = new Date(),
}) {
  const normalizedCaptureName = normalizeDatasetSegment(captureName, {
    fieldName: "captureName",
    defaultValue: config.datasetCaptureName,
  });

  let computedSceneName = sceneName?.trim();
  if (!computedSceneName) {
    const sessionTimeMatch = sessionName.match(SESSION_TIME_PATTERN);
    if (sessionTimeMatch) {
      const [, y, m, d, h, mm, s] = sessionTimeMatch;
      computedSceneName = `${config.datasetSceneName}_${y}${m}${d}_${h}${mm}${s}`;
    } else {
      const nowIso = now.toISOString();
      const ymd = nowIso.slice(0, 10).replace(/-/g, "");
      const hms = nowIso.slice(11, 19).replace(/:/g, "");
      computedSceneName = `${config.datasetSceneName}_${ymd}_${hms}`;
    }
  }

  const normalizedSceneName = normalizeDatasetSegment(computedSceneName, {
    fieldName: "sceneName",
  });

  const normalizedSeqName = normalizeDatasetSegment(seqName, {
    fieldName: "seqName",
    defaultValue: config.datasetSeqName,
  });

  const sessionBaseName = sessionName.toLowerCase().endsWith(".zip")
    ? sessionName.slice(0, -4)
    : sessionName;

  const fileName = `${sessionBaseName}.zip`;
  const finalSceneDir = path.join(
    config.uploadRootDir,
    normalizedCaptureName,
    normalizedSceneName,
  );
  const finalDir = path.join(finalSceneDir, normalizedSeqName);
  const finalPath = path.join(finalDir, fileName);
  const stagingPath = path.join(
    config.stagingDir,
    `${taskId}_${Date.now()}_${Math.round(Math.random() * 1e6)}.part`,
  );

  return {
    captureName: normalizedCaptureName,
    sceneName: normalizedSceneName,
    seqName: normalizedSeqName,
    finalSceneDir,
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
  await fs.rm(finalPath, { force: true });
  await fs.rename(stagingPath, finalPath);
}

function normalizeArchiveEntryPath(entryPath) {
  return entryPath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function resolveSceneRelativePath(entryPath) {
  const normalized = normalizeArchiveEntryPath(entryPath);
  if (!normalized) {
    return null;
  }

  const candidates = [normalized];
  const firstSlash = normalized.indexOf("/");
  if (firstSlash > 0) {
    candidates.push(normalized.slice(firstSlash + 1));
  }

  for (const candidate of candidates) {
    if (SCENE_ROOT_IGNORED_FILES.has(candidate)) {
      return {
        ignore: true,
      };
    }

    if (
      SCENE_ROOT_ALLOWED_FILES.has(candidate) ||
      candidate.startsWith("frames2/")
    ) {
      return {
        ignore: false,
        relativePath: candidate,
      };
    }
  }

  return null;
}

export async function extractSceneFilesFromZip({ zipPath, sceneDir }) {
  await fs.mkdir(sceneDir, { recursive: true });

  const archive = await unzipper.Open.file(zipPath);
  const extractedPaths = [];

  for (const entry of archive.files) {
    if (entry.type !== "File") {
      continue;
    }

    const resolved = resolveSceneRelativePath(entry.path ?? "");
    if (!resolved || resolved.ignore) {
      continue;
    }

    const outputPath = path.join(sceneDir, ...resolved.relativePath.split("/"));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const output = createWriteStream(outputPath, { flags: "w" });
    await pipeline(entry.stream(), output);
    extractedPaths.push(resolved.relativePath);
  }

  await safeDeleteFile(path.join(sceneDir, "data2.mov"));

  extractedPaths.sort((a, b) => a.localeCompare(b));
  return extractedPaths;
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
