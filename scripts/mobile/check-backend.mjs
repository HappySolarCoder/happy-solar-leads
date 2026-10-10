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
  ["/api/field-config", "Sign in to use field tools."],
  ["/api/field-work", "Sign in to use field tools."],
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
    "The corresponding backend companion needs review/deployment. Installing the app does not deploy API routes. See docs/mobile-next/FIELD-V11.md."
  );
  process.exitCode = 1;
} else {
  console.log(
    "All four management/field routes are available. Signed-in requests also validate server Firebase credentials and your account access."
  );
}
