import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { checkBlobs, createBlobs } from "./blobs.ts";
import { readConfig } from "./config.ts";
import { createStore } from "./db.ts";
import { moveFromVolume } from "./move-from-volume.ts";

const config = readConfig();
const blobs = createBlobs(config);
// A wrong bucket setting stops the start here, before anything is moved or saved.
if (blobs.where === "bucket") await checkBlobs(blobs);
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
await moveFromVolume(db, config.dataDir, blobs, {
  database: !!config.databaseUrl,
  log: (line) => console.log(line),
});
await db.recoverInterruptedActions();
const { app, agent, liveVoice, pipecatVoice } = await createApp(db, config, { blobs });
console.log(liveVoice.describe());
console.log(
  pipecatVoice
    ? `Our own voice on (${config.voiceServiceUrl}; default voice ${config.voiceProvider ?? "openai"}${config.turnKeyId ? "" : "; no TURN relay: set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN"})`
    : "Our own voice off: VOICE_SERVICE_URL or VOICE_INTERNAL_TOKEN isn't set",
);
console.log(
  config.sonioxApiKey
    ? `Recording meetings on (Soniox; ${config.meetingMonthlyHours ? `${config.meetingMonthlyHours} hours a month each` : "no monthly limit"})`
    : "Recording meetings off: SONIOX_API_KEY isn't set on the api",
);
if (config.taskWorkerEnabled && pipecatVoice)
  void fetch(`${config.voiceServiceUrl}/health`, { signal: AbortSignal.timeout(10000) }).then(
    async (response) => {
      const health = (await response.json().catch(() => ({}))) as { missing?: string[] };
      console.log(
        response.ok
          ? "Voice service reachable"
          : `Voice service health check ${response.status}${health.missing?.length ? ` (missing: ${health.missing.join(", ")})` : ""}`,
      );
    },
    (error) =>
      console.warn(
        `Voice service unreachable: ${error instanceof Error ? error.message : "no response"}`,
      ),
  );
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
// During an update the new copy is already serving: this one stops its background work at once,
// finishes the requests it has (a reply being written), then exits.
const shutdown = () => {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  void Promise.all([agent.stop(), liveVoice.stop(), pipecatVoice?.stop(), closed])
    .then(() => db.close())
    .then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
