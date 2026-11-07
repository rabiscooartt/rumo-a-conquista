import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Credenciais descartáveis, geradas a cada execução. Elas existem apenas na memória do servidor
// local de teste; as credenciais reais do Admin nunca entram nos testes, no código ou nos logs.
process.env.E2E_ADMIN_USER ||= `e2e-${randomBytes(6).toString("hex")}`;
process.env.E2E_ADMIN_PASSWORD ||= randomBytes(24).toString("base64url");
process.env.E2E_SESSION_SECRET ||= randomBytes(32).toString("base64url");

const PORT = Number(process.env.E2E_PORT || 3210);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    // Usa o build de produção já gerado por `npm run build`.
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ADMIN_USER: process.env.E2E_ADMIN_USER,
      ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
      ADMIN_SESSION_SECRET: process.env.E2E_SESSION_SECRET,
    },
  },
});
