import fs from "node:fs/promises";
import path from "node:path";

export class IdempotencyStore {
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;
    this.records = new Map();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.records) {
        return;
      }

      for (const [taskId, value] of Object.entries(parsed.records)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        this.records.set(taskId, value);
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        await this.persist();
        return;
      }

      this.logger.warn(
        { err: error },
        "Failed to read idempotency store, starting with empty state.",
      );
    }
  }

  get(taskId) {
    return this.records.get(taskId) ?? null;
  }

  async markSuccess(taskId, record) {
    this.records.set(taskId, {
      ...record,
      status: "success",
      uploadedAt: record.uploadedAt,
    });
    await this.persist();
  }

  async persist() {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: Object.fromEntries(this.records.entries()),
    };

    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");

    try {
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      if (error && (error.code === "EEXIST" || error.code === "EPERM")) {
        await fs.rm(this.filePath, { force: true });
        await fs.rename(tempPath, this.filePath);
        return;
      }
      throw error;
    }
  }
}
