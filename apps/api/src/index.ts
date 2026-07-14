import "dotenv/config";
import { buildApp } from "./app.js";
import { logger } from "./util/logger.js";

async function main(): Promise<void> {
  const { app, config } = await buildApp();
  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(`nightwriter api listening on http://${config.host}:${config.port}`);
  } catch (err) {
    logger.error("failed to start server", {
      msg: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  const shutdown = async (sig: string) => {
    logger.info(`received ${sig}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
