import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  // Every test shares one server, database and simulated clock, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // PLINTH_E2E turns on the reset route that each test calls first to restore the seed (e2e/restore-seed.ts).
    env: { PLINTH_DB_PATH: path.join(os.tmpdir(), `plinth-e2e-${randomUUID()}.db`), PLINTH_E2E: "1" },
  },
});
