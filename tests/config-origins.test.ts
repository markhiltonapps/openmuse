import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../apps/server/src/config.ts";

test("a custom domain can be allowed without restating the other web addresses", () => {
  const saved = { ...process.env };
  try {
    process.env.ALLOWED_ORIGINS = "https://web-production.up.railway.app/";
    process.env.EXTRA_ALLOWED_ORIGINS = " https://muse.neatoventures.com ,";
    delete process.env.APP_URL;
    process.env.CPK_INTELLIGENCE_API_KEY = "test-project-key-never-sent";
    const config = readConfig();
    assert.deepEqual(config.allowedOrigins, [
      "https://web-production.up.railway.app",
      "https://muse.neatoventures.com",
    ]);
    // Sign-in links keep going to the first address until APP_URL says otherwise.
    assert.equal(config.appUrl, "https://web-production.up.railway.app");
  } finally {
    process.env = saved;
  }
});
