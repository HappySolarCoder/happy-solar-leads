import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), false);
const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
if (!configured)
  throw new Error("Set NEXT_PUBLIC_API_BASE_URL in .env.local first.");
const origin = new URL(configured);
if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
)
  throw new Error(
    "The backend must be an HTTPS origin without a path or credentials."
  );
const url = new URL("/api/territory-management", origin);
console.log(`Checking ${url.href} (no login credentials sent)`);
try {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (
    response.status === 401 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const result = await response.json();
    if (result.error === "Sign in again to manage territories.") {
      console.log(
        "READY: territory route is deployed and requires authentication. Open Manage territories in the app."
      );
      console.log(
        "This checks route availability only. The signed-in request also validates server Firebase credentials and account access."
      );
      process.exit(0);
    }
  }
  console.error(
    `NOT READY: HTTP ${response.status}. Expected the territory route's JSON 401 authentication response.`
  );
  if (response.status === 404)
    console.error(
      "Deploy backend-only PR #151 to this Vercel project. Installing the mobile app does not deploy API routes. See docs/mobile-next/FIELD-V7.md."
    );
  process.exitCode = 1;
} catch (error) {
  console.error(`Could not reach the configured backend: ${error.message}`);
  process.exitCode = 1;
}
