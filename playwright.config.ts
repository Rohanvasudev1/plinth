import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Each end-to-end run starts from a fresh database.
    env: { PLINTH_DB_PATH: path.join(os.tmpdir(), `plinth-e2e-${Date.now()}.db`) },
  },
});
