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
for (const [path, expected, required] of [
  ["/api/territory-management", "Sign in again to manage territories.", true],
  ["/api/mobile-user-management", "Sign in again to manage users.", false],
  ["/api/field-config", "Sign in to use field tools.", false],
  ["/api/field-work", "Sign in to use field tools.", false],
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
      if (required) ready = false;
      console.error(
        `${required ? "NOT READY" : "OPTIONAL / UNAVAILABLE"}: ${path} returned HTTP ${response.status}. This does not block direct mobile knock saves.`
      );
    }
  } catch (error) {
    if (required) ready = false;
    console.error(`Could not reach ${url.href}: ${error.message}`);
  }
}
if (!ready) {
  console.error(
    "Territory management needs backend review. Mobile v12.6 saves knocks directly to Firestore; do not deploy field routes to enable knocking. See docs/mobile-next/FIELD-V12.6.md."
  );
  process.exitCode = 1;
} else {
  console.log(
    "Territory route is available. Optional user-management/field services may still be unavailable. Mobile knocks do not use these services."
  );
}
