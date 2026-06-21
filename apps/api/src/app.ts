import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createAdapterRegistry } from "./adapters/index.js";
import { type AppConfig, loadConfig } from "./config.js";
import { createRunner } from "./generate/runner.js";
import { JobStore } from "./jobs/store.js";
import { registerGenerateRoutes } from "./routes/generate.js";

export interface BuiltApp {
  app: FastifyInstance;
  store: JobStore;
  config: AppConfig;
}

/** Build the Fastify app and job store without listening (used by tests). */
export async function buildApp(
  overrides: Partial<AppConfig> = {},
): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides };
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  await app.register(cors, { origin: config.corsOrigin });

  const registry = createAdapterRegistry(config);
  const runner = createRunner(config, registry);
  const store = new JobStore(config, runner);
  store.start();

  app.get("/health", async () => ({ ok: true }));
  registerGenerateRoutes(app, store);

  app.addHook("onClose", async () => {
    await store.stop();
  });

  return { app, store, config };
}
