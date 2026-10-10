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
let ready = true;
for (const [path, expected] of [
  ["/api/territory-management", "Sign in again to manage territories."],
  ["/api/mobile-user-management", "Sign in again to manage users."],
]) {
  const url = new URL(path, origin);
  console.log(`Checking ${url.href} (no login credentials sent)`);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const json = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : null;
    if (response.status === 401 && json?.error === expected) {
      console.log(`READY: ${path} is deployed and requires authentication.`);
    } else {
      ready = false;
      console.error(
        `NOT READY: ${path} returned HTTP ${response.status}. Expected its JSON 401 authentication response.`
      );
    }
  } catch (error) {
    ready = false;
    console.error(`Could not reach ${url.href}: ${error.message}`);
  }
}
if (!ready) {
  console.error(
    "Deploy the v10 backend-only PR, then check again. Installing the app does not deploy API routes. See docs/mobile-next/FIELD-V10.md."
  );
  process.exitCode = 1;
} else {
  console.log(
    "Both management routes are available. Signed-in requests also validate server Firebase credentials and your account access."
  );
}
