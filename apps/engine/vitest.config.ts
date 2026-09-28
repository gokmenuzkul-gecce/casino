import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load the repo .env so engine tests run against the same Postgres, Redis and
 * secrets the app uses. Tests that need infrastructure assert on real state, so
 * a developer running `npm test` after the cold-start commands gets the same
 * environment the server does.
 */
function loadRootEnv(): Record<string, string> {
  const path = resolve(__dirname, "../../.env");
  if (!existsSync(path)) return {};

  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}

export default defineConfig({
  test: {
    env: loadRootEnv(),
    // Tests touch shared database rows, so keep files from racing each other.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
