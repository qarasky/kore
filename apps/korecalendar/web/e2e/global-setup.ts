import { buildApi, resetApi } from "./harness/api-server";
import { buildWeb, hasBuild, startWeb } from "./harness/web-server";
import { stopProcess } from "./harness/proc";

/**
 * Build the API and the production web app, then start both. Specs reset the
 * API's data themselves (`resetApi`); the web server is stateless and is shared.
 * `E2E_SKIP_BUILD=1` reuses an existing web build.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  buildApi();
  if (process.env.E2E_SKIP_BUILD !== "1" || !hasBuild()) buildWeb();
  await resetApi();
  await startWeb();
  return async () => {
    for (const name of ["web-dead", "web", "api"]) stopProcess(name);
  };
}
