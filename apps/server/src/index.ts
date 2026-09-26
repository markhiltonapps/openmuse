import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { createStore } from "./db.ts";

const config = readConfig();
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
await db.recoverInterruptedActions();
const { app, agent } = await createApp(db, config);
if (config.taskWorkerEnabled) agent.start();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () =>
  console.log(`OpenMuse ${config.mode} API ready at ${config.publicUrl}`),
);
if (config.workerUrl)
  void fetch(`${config.workerUrl}/health`, { signal: AbortSignal.timeout(10000) }).then(
    (response) =>
      console.log(
        response.ok ? "Agent browser reachable" : `Agent browser health check ${response.status}`,
      ),
    (error) =>
      console.warn(
        `Agent browser unreachable: ${error instanceof Error ? error.message : "no response"}`,
      ),
  );
const shutdown = () => {
  server.close(() => {
    void agent
      .stop()
      .then(() => db.close())
      .then(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
