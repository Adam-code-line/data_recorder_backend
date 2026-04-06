import dotenv from "dotenv";

import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

dotenv.config();

const config = loadConfig();
const app = await buildServer(config);

async function shutdown(signal) {
  app.log.info({ signal }, "Shutdown signal received.");
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Failed to close server.");
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });

  app.log.info(
    {
      host: config.host,
      port: config.port,
      uploadRootDir: config.uploadRootDir,
      requireAuth: config.requireAuth,
    },
    "Server started.",
  );
} catch (error) {
  app.log.error({ err: error }, "Failed to start server.");
  process.exit(1);
}
