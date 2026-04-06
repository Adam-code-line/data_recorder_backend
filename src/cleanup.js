import fs from "node:fs/promises";
import path from "node:path";

async function removeEmptyDirIfPossible(dirPath, rootPath) {
  if (dirPath === rootPath) {
    return;
  }

  try {
    const entries = await fs.readdir(dirPath);
    if (entries.length === 0) {
      await fs.rmdir(dirPath);
      const parent = path.dirname(dirPath);
      if (parent !== dirPath) {
        await removeEmptyDirIfPossible(parent, rootPath);
      }
    }
  } catch {
    // Ignore non-critical cleanup errors.
  }
}

export async function cleanupExpiredZipFiles({
  uploadRootDir,
  retentionDays,
  logger,
}) {
  const cutoffTs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removedCount = 0;

  async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".staging") {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        await removeEmptyDirIfPossible(fullPath, uploadRootDir);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".zip")) {
        continue;
      }

      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoffTs) {
        await fs.unlink(fullPath);
        removedCount += 1;
      }
    }
  }

  try {
    await walk(uploadRootDir);
    if (removedCount > 0) {
      logger.info({ removedCount }, "Expired ZIP files cleaned.");
    }
  } catch (error) {
    logger.warn({ err: error }, "Failed to clean expired ZIP files.");
  }
}

export function startCleanupScheduler({ config, logger }) {
  const run = async () => {
    await cleanupExpiredZipFiles({
      uploadRootDir: config.uploadRootDir,
      retentionDays: config.retentionDays,
      logger,
    });
  };

  void run();

  const timer = setInterval(
    () => {
      void run();
    },
    config.cleanupIntervalMinutes * 60 * 1000,
  );

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => clearInterval(timer);
}
