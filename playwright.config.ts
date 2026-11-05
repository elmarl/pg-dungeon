import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.SMOKE_BASE_URL;
const localUrl = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./smoke",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: deployedUrl ?? localUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(deployedUrl
    ? {}
    : {
        webServer: {
          command:
            "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
          url: localUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
