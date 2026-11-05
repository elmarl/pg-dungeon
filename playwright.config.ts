import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.SMOKE_BASE_URL;
const vercelTrustedOidcToken = process.env.VERCEL_TRUSTED_OIDC_TOKEN;
const localUrl = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./smoke",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: deployedUrl ?? localUrl,
    ...(vercelTrustedOidcToken
      ? {
          extraHTTPHeaders: {
            "x-vercel-trusted-oidc-idp-token": vercelTrustedOidcToken,
          },
        }
      : {}),
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
