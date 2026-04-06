export class RuntimeMetrics {
  constructor({ windowSize = 500 } = {}) {
    this.windowSize = windowSize;
    this.totalRequests = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.totalUploadedBytes = 0;
    this.lastUploadAt = null;
    this.durationWindow = [];
  }

  recordSuccess({ durationMs, uploadedBytes }) {
    this.totalRequests += 1;
    this.successCount += 1;
    this.totalUploadedBytes += uploadedBytes;
    this.lastUploadAt = new Date().toISOString();
    this.#appendDuration(durationMs);
  }

  recordFailure({ durationMs }) {
    this.totalRequests += 1;
    this.failureCount += 1;
    this.#appendDuration(durationMs);
  }

  snapshot() {
    const durationP95Ms = this.#computeP95();
    const successRate =
      this.totalRequests === 0
        ? 0
        : Number((this.successCount / this.totalRequests).toFixed(4));

    return {
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate,
      totalUploadedBytes: this.totalUploadedBytes,
      durationP95Ms,
      lastUploadAt: this.lastUploadAt,
      sampleSize: this.durationWindow.length,
    };
  }

  #appendDuration(durationMs) {
    const safeDuration = Number.isFinite(durationMs)
      ? Math.max(0, Math.round(durationMs))
      : 0;

    this.durationWindow.push(safeDuration);
    if (this.durationWindow.length > this.windowSize) {
      this.durationWindow.shift();
    }
  }

  #computeP95() {
    if (this.durationWindow.length === 0) {
      return 0;
    }

    const sorted = [...this.durationWindow].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.ceil(sorted.length * 0.95) - 1,
    );

    return sorted[index];
  }
}
