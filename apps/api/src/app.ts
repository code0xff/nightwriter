import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createAdapterRegistry } from "./adapters/index.js";
import { AuthService } from "./auth/service.js";
import { makeGuards } from "./auth/guards.js";
import { ChatStore } from "./chat/store.js";
import { createRuntimeRegistry } from "./chat/runtimes/index.js";
import { type AppConfig, loadConfig } from "./config.js";
import { type Database, openDatabase } from "./db/index.js";
import { createRunner } from "./generate/runner.js";
import { HistoryStore } from "./history/store.js";
import { JobStore } from "./jobs/store.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerGenerateRoutes } from "./routes/generate.js";
import { registerHistoryRoutes } from "./routes/history.js";

export interface BuiltApp {
  app: FastifyInstance;
  store: JobStore;
  chatStore: ChatStore;
  auth: AuthService;
  history: HistoryStore;
  db: Database;
  config: AppConfig;
}

/** Build the Fastify app and stores without listening (used by tests). */
export async function buildApp(
  overrides: Partial<AppConfig> = {},
): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides };
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  await app.register(cors, { origin: config.corsOrigin });

  const db = await openDatabase(config);
  const auth = await AuthService.open(config, db);
  const history = await HistoryStore.open(db.history, config.dataRoot);
  const guards = makeGuards(auth);

  const registry = createAdapterRegistry(config);
  const runner = createRunner(config, registry);
  const store = new JobStore(config, runner, async (record) => {
    await history.persist({
      id: record.id,
      ownerId: record.ownerId,
      prompt: record.prompt,
      generator: record.generator,
      target: record.target,
      slug: record.slug,
      files: record.files,
      zipPath: record.zipPath,
      definition: record.definition,
      definitionFile: record.definitionFile,
    });
  });
  store.start();

  const runtimes = createRuntimeRegistry(config);
  const chatStore = new ChatStore(config, db.chats, db.history, runtimes);
  chatStore.start();

  app.get("/health", async () => ({ ok: true }));
  registerAuthRoutes(app, auth, guards);
  registerAccountRoutes(app, auth, guards);
  registerAdminRoutes(app, auth, guards);
  registerGenerateRoutes(app, store, guards);
  registerHistoryRoutes(app, history, guards);
  registerChatRoutes(app, chatStore, guards);

  app.addHook("onClose", async () => {
    await store.stop();
    await chatStore.stop();
    await db.close();
  });

  return { app, store, chatStore, auth, history, db, config };
}
