import path from "node:path";

function parseIntEnv(name, defaultValue, { min = undefined } = {}) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Env ${name} must be an integer, current value: ${raw}`);
  }

  if (min != null && value < min) {
    throw new Error(
      `Env ${name} cannot be less than ${min}, current value: ${value}`,
    );
  }

  return value;
}

function parseBoolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseCsvEnv(name, defaultValue = []) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHostEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }

  const value = raw.trim();

  // Allow users to configure HOST as [::] in .env and normalize to ::
  if (value.startsWith("[") && value.endsWith("]")) {
    const normalized = value.slice(1, -1).trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return value;
}

export function loadConfig() {
  const rootDir = process.cwd();

  const rawUploadRootDir =
    process.env.UPLOAD_ROOT_DIR ?? path.join("data", "uploads");
  const uploadRootDir = path.isAbsolute(rawUploadRootDir)
    ? rawUploadRootDir
    : path.resolve(rootDir, rawUploadRootDir);

  const stagingDir = path.join(uploadRootDir, ".staging");
  const rawIdempotencyFilePath =
    process.env.IDEMPOTENCY_FILE_PATH ??
    path.join("data", "idempotency-store.json");
  const idempotencyFilePath = path.isAbsolute(rawIdempotencyFilePath)
    ? rawIdempotencyFilePath
    : path.resolve(rootDir, rawIdempotencyFilePath);

  const authTokens = parseCsvEnv("AUTH_TOKENS");
  const requireAuth = parseBoolEnv("REQUIRE_AUTH", true);

  if (requireAuth && authTokens.length === 0) {
    throw new Error(
      "AUTH_TOKENS is required when REQUIRE_AUTH=true (comma-separated).",
    );
  }

  const maxFileSizeMb = parseIntEnv("MAX_FILE_SIZE_MB", 1024, { min: 1 });
  const diskFreeThresholdMb = parseIntEnv("DISK_FREE_THRESHOLD_MB", 1024, {
    min: 0,
  });

  const retentionDays = parseIntEnv("UPLOAD_RETENTION_DAYS", 14, { min: 1 });
  const cleanupIntervalMinutes = parseIntEnv("CLEANUP_INTERVAL_MINUTES", 60, {
    min: 1,
  });

  const allowedMimeTypes = new Set(
    parseCsvEnv("ALLOWED_MIME_TYPES", [
      "application/zip",
      "application/x-zip-compressed",
      "application/octet-stream",
      "multipart/x-zip",
    ]),
  );

  return Object.freeze({
    appName: process.env.APP_NAME ?? "data-recorder-backend",
    host: parseHostEnv("HOST", "::"),
    port: parseIntEnv("PORT", 8080, { min: 1 }),
    ipv6Only: parseBoolEnv("IPV6_ONLY", false),
    logLevel: process.env.LOG_LEVEL ?? "info",

    uploadRootDir,
    stagingDir,
    idempotencyFilePath,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    diskFreeThresholdBytes: diskFreeThresholdMb * 1024 * 1024,
    allowedMimeTypes,

    requireAuth,
    authTokens,
    legacyTokenHeaderName: (
      process.env.LEGACY_TOKEN_HEADER_NAME ?? "x-upload-token"
    ).toLowerCase(),

    retentionDays,
    cleanupIntervalMinutes,

    metricsWindowSize: parseIntEnv("METRICS_WINDOW_SIZE", 500, { min: 50 }),
  });
}
