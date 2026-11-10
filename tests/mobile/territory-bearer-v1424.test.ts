import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeLeadSnapshots } from "../../app/homeowners/houseIdentity";
import {
  anyTerritoryOwnership,
  isTerritoryWarningCancelled,
  noteMobileLeadsMeta,
  resetOwnerCountsForTests,
  takeCountedToast,
  TERRITORY_WARNING,
  territoryCheckNeeded,
} from "../../app/mobile/_lib/ownerCounts";
import {
  checkNewPinTerritory,
  guardNewPinTerritory,
  parseTerritoryCheck,
  pinSaveTimestamps,
  resetTerritoryCheckForTests,
  TERRITORY_CHECK_BACKOFF_MS,
  TERRITORY_CHECK_PATH,
  TERRITORY_CHECK_TIMEOUT_MS,
  type TerritoryCheckDeps,
} from "../../app/field/territoryCheck";
import {
  apiFetch,
  BEARER_TOKEN_TIMEOUT_MS,
  bearerForPath,
  nativeApiFetch,
  resolveApiUrl,
  wantsBearer,
} from "../../app/utils/apiFetch";
import type { Lead } from "../../app/types";
import release from "../../app/mobile/_lib/release.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "f2d86df30463239505015289e0d1220c74bb9c57";
const UID = "rep-1";
const TOKEN = "TEST_TOKEN";
const PIN = { lat: 33.51, lng: -112.07 };
const DEVICE_GPS = { lat: 40.71, lng: -74.01 };
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

function read(rel: string) {
  return readFileSync(path.join(root, rel), "utf8");
}

function fresh() {
  resetOwnerCountsForTests();
  resetTerritoryCheckForTests();
}

afterEach(() => fresh());

function jsonResponse(status: number, body: unknown, contentType = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": contentType } });
}

function verdict(patch: Record<string, unknown> = {}) {
  return {
    ok: true,
    ownership: "territory",
    warn: true,
    popupExempt: false,
    inOtherUsersTerritory: true,
    owners: [{ uid: "owner-1", name: "Pat L." }],
    message: "SERVER_TEXT_SHOULD_NOT_SHOW",
    ...patch,
  };
}

function deps(over: TerritoryCheckDeps = {}): TerritoryCheckDeps {
  return {
    online: () => true,
    currentUid: () => UID,
    getToken: async () => TOKEN,
    now: () => 1_700_000_000_000,
    timeoutMs: 40,
    send: async () => jsonResponse(200, verdict()),
    ...over,
  };
}

function headerValue(headers: Record<string, string> | undefined, name: string) {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return undefined;
}

function spyConsole() {
  const calls: string[] = [];
  const previous = new Map<string, typeof console.log>();
  for (const method of CONSOLE_METHODS) {
    previous.set(method, console[method]);
    console[method] = (...args: unknown[]) => {
      calls.push(args.map((item) => String(item)).join(" "));
    };
  }
  return {
    calls,
    restore() {
      for (const method of CONSOLE_METHODS) console[method] = previous.get(method)!;
    },
  };
}

function nativeOk(request: { url: string }) {
  return { status: 200, data: "{}", headers: {}, url: request.url };
}

function pin(patch: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    name: "Pin",
    address: "1 Test St",
    city: "Town",
    state: "AZ",
    zip: "85001",
    status: "go-back",
    disposition: "Go Back",
    createdAt: new Date("2026-11-10T18:00:00.000Z"),
    ...patch,
  };
}

type FakeTimers = {
  fire(ms: number): void;
  pending(): number;
  cleared(): number;
};

async function withFakeTimers<T>(run: (timers: FakeTimers) => Promise<T>): Promise<T> {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const queue: { fn: () => void; ms: number; id: number }[] = [];
  let seq = 1;
  let clears = 0;
  globalThis.setTimeout = ((fn: TimerHandler, ms?: number) => {
    const id = seq++;
    queue.push({ fn: () => { (fn as () => void)(); }, ms: ms ?? 0, id });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    clears += 1;
    const index = queue.findIndex((item) => item.id === id);
    if (index >= 0) queue.splice(index, 1);
    return realClear(id as never);
  }) as typeof clearTimeout;
  try {
    return await run({
      fire(ms: number) {
        const index = queue.findIndex((item) => item.ms === ms);
        if (index < 0) throw new Error(`no ${ms}ms timer`);
        const [item] = queue.splice(index, 1);
        item.fn();
      },
      pending: () => queue.length,
      cleared: () => clears,
    });
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "out" || name === ".next") continue;
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("Raydar 14.24 build 168 territory check and bearer", { concurrency: 1 }, () => {
  test("TC1 territory warn opens the app popup once and ignores server text", async () => {
    fresh();
    assert.equal(TERRITORY_WARNING, "Warning: You are in another user's territory. Do you wish to place this pin?");
    assert.equal(territoryCheckNeeded(UID), true);
    const calls: unknown[][] = [];
    const result = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
      deps: deps(),
    });
    assert.deepEqual(result, { checked: true, warned: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], []);
    const parsed = parseTerritoryCheck(verdict());
    assert.equal(parsed?.warn, true);
    assert.equal(JSON.stringify(parsed).includes("SERVER_TEXT_SHOULD_NOT_SHOW"), false);
    assert.deepEqual(parsed?.owners, [{ uid: "owner-1", name: "Pat L." }]);
    const many = [
      { uid: "u0", name: "A" },
      { uid: "", name: "drop" },
      { uid: "bad", name: 4 },
      { uid: "u1", name: null },
      { uid: "u2", name: "C" },
      { uid: "u3", name: "D" },
      { uid: "u4", name: "E" },
      { uid: "u5", name: "F" },
    ];
    const capped = parseTerritoryCheck(verdict({ owners: many }));
    assert.deepEqual(capped?.owners.map((owner) => owner.uid), ["u0", "u1", "u2", "u3", "u4"]);
    const map = read("app/components/LeadMap.tsx");
    assert.match(map, /window\.confirm\(TERRITORY_WARNING\)/);
    assert.equal(map.includes("SERVER_TEXT"), false);
  });

  test("TC2 territory warn false places the pin with no popup", async () => {
    fresh();
    let confirms = 0;
    const result = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({ send: async () => jsonResponse(200, verdict({ warn: false, inOtherUsersTerritory: false, owners: [] })) }),
    });
    assert.deepEqual(result, { checked: true, warned: false });
    assert.equal(confirms, 0);
    assert.equal(parseTerritoryCheck(verdict({ warn: false }))?.warn, false);
  });

  test("TC3 popupExempt suppresses the popup and skips the request for an exempt session", async () => {
    fresh();
    let confirms = 0;
    let sends = 0;
    const result = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({
        send: async () => {
          sends += 1;
          return jsonResponse(200, verdict({ warn: true, popupExempt: true }));
        },
      }),
    });
    assert.deepEqual(result, { checked: true, warned: false });
    assert.equal(confirms, 0);
    assert.equal(sends, 1);
    assert.equal(parseTerritoryCheck(verdict({ warn: true, popupExempt: true }))?.warn, false);
    fresh();
    noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: true });
    assert.equal(territoryCheckNeeded(UID), false);
    sends = 0;
    const skipped = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({
        send: async () => {
          sends += 1;
          return jsonResponse(200, verdict());
        },
      }),
    });
    assert.deepEqual(skipped, { checked: false, warned: false });
    assert.equal(sends, 0);
    assert.equal(confirms, 0);
  });

  test("TC4 legacy ownership never pops and a legacy session makes zero requests", async () => {
    fresh();
    let confirms = 0;
    const result = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({ send: async () => jsonResponse(200, verdict({ ownership: "legacy", warn: true })) }),
    });
    assert.deepEqual(result, { checked: true, warned: false });
    assert.equal(confirms, 0);
    assert.equal(parseTerritoryCheck(verdict({ ownership: "legacy", warn: true, inOtherUsersTerritory: false, owners: [] }))?.warn, false);
    fresh();
    noteMobileLeadsMeta(UID, { ownership: "legacy", popupExempt: false });
    assert.equal(territoryCheckNeeded(UID), false);
    let sends = 0;
    let tokens = 0;
    const skipped = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({
        getToken: async () => {
          tokens += 1;
          return TOKEN;
        },
        send: async () => {
          sends += 1;
          return jsonResponse(200, verdict());
        },
      }),
    });
    assert.deepEqual(skipped, { checked: false, warned: false });
    assert.equal(sends, 0);
    assert.equal(tokens, 0);
    assert.equal(confirms, 0);
  });

  test("TC5 a hung request resolves null inside the budget and a late warn cannot pop", async () => {
    fresh();
    assert.equal(TERRITORY_CHECK_TIMEOUT_MS, 1500);
    let release: (response: Response) => void = () => {};
    let confirms = 0;
    let sends = 0;
    const started = Date.now();
    const pending = guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({
        timeoutMs: 30,
        send: () => {
          sends += 1;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      }),
    });
    const result = await pending;
    const elapsed = Date.now() - started;
    assert.deepEqual(result, { checked: true, warned: false });
    assert.ok(elapsed < 1000, `elapsed ${elapsed}`);
    assert.equal(confirms, 0);
    assert.equal(sends, 1);
    release(jsonResponse(200, verdict()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(confirms, 0);

    fresh();
    let lateSends = 0;
    const hungToken = checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
      timeoutMs: 25,
      getToken: () => new Promise(() => {}),
      send: async () => {
        lateSends += 1;
        return jsonResponse(200, verdict());
      },
    }));
    assert.equal(await hungToken, null);
    assert.equal(lateSends, 0);
  });

  test("TC6 failures fail open, and only 404 and 405 back off", async () => {
    fresh();
    const backoffStatuses = new Set([404, 405]);
    for (const status of [500, 503, 401, 403, 400, 404, 405, 429]) {
      fresh();
      let clock = 1_700_000_000_000;
      let sends = 0;
      let confirms = 0;
      const send = async () => {
        sends += 1;
        return jsonResponse(status, { ok: false, error: "x" });
      };
      const result = await guardNewPinTerritory({
        uid: UID,
        lat: PIN.lat,
        lng: PIN.lng,
        confirm: () => {
          confirms += 1;
          return true;
        },
        deps: deps({ send, now: () => clock }),
      });
      assert.equal(result.warned, false, String(status));
      assert.equal(confirms, 0, String(status));
      assert.equal(sends, 1, String(status));
      await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({ send, now: () => clock }));
      if (backoffStatuses.has(status)) {
        assert.equal(sends, 1, `${status} second call`);
        clock += TERRITORY_CHECK_BACKOFF_MS;
        await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({ send, now: () => clock }));
        assert.equal(sends, 2, `${status} after backoff`);
      } else if (status === 500) {
        assert.equal(sends, 2, "500 does not back off");
      }
    }

    fresh();
    const quiet = async (send: TerritoryCheckDeps["send"]) => {
      let confirms = 0;
      const result = await guardNewPinTerritory({
        uid: UID,
        lat: PIN.lat,
        lng: PIN.lng,
        confirm: () => {
          confirms += 1;
          return true;
        },
        deps: deps({ send }),
      });
      assert.equal(result.warned, false);
      assert.equal(confirms, 0);
      return result;
    };
    assert.deepEqual(await quiet(async () => jsonResponse(200, "not-json", "text/plain")), { checked: true, warned: false });
    assert.deepEqual(await quiet(async () => jsonResponse(200, { ok: false, error: "unavailable" })), { checked: true, warned: false });
    assert.deepEqual(await quiet(async () => jsonResponse(200, verdict({ warn: "yes", owners: {} }))), { checked: true, warned: false });
    assert.equal(parseTerritoryCheck(verdict({ ownership: "nope" })), null);
    assert.equal(parseTerritoryCheck(verdict({ inOtherUsersTerritory: "yes" })), null);
    assert.equal(parseTerritoryCheck(null), null);
    let sends = 0;
    await quiet(async () => {
      sends += 1;
      throw new Error(`network ${TOKEN}`);
    });
    assert.equal(sends, 1);
    await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
      send: async () => {
        sends += 1;
        throw new Error("again");
      },
    }));
    assert.equal(sends, 2);

    fresh();
    let tokens = 0;
    let missingSends = 0;
    assert.equal(await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
      getToken: async () => null,
      send: async () => {
        missingSends += 1;
        return jsonResponse(200, verdict());
      },
    })), null);
    assert.equal(await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
      getToken: async () => {
        tokens += 1;
        throw new Error(`reject ${TOKEN}`);
      },
      send: async () => {
        missingSends += 1;
        return jsonResponse(200, verdict());
      },
    })), null);
    assert.equal(missingSends, 0);
    assert.equal(tokens, 1);
  });

  test("TC7 offline makes zero requests and does not read a token", async () => {
    fresh();
    let sends = 0;
    let tokens = 0;
    let confirms = 0;
    const result = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => {
        confirms += 1;
        return true;
      },
      deps: deps({
        online: () => false,
        getToken: async () => {
          tokens += 1;
          return TOKEN;
        },
        send: async () => {
          sends += 1;
          return jsonResponse(200, verdict());
        },
      }),
    });
    assert.deepEqual(result, { checked: true, warned: false });
    assert.equal(sends, 0);
    assert.equal(tokens, 0);
    assert.equal(confirms, 0);
  });

  test("TC8 cancel rejects before saveManualLead so no draft or pin is written", async () => {
    fresh();
    let saves = 0;
    const saveManualLead = () => {
      saves += 1;
    };
    await assert.rejects(async () => {
      const guard = await guardNewPinTerritory({
        uid: UID,
        lat: PIN.lat,
        lng: PIN.lng,
        confirm: () => false,
        deps: deps(),
      });
      saveManualLead();
      return guard;
    }, (error: unknown) => isTerritoryWarningCancelled(error));
    assert.equal(saves, 0);
    const body = read("app/components/LeadMap.tsx");
    const start = body.indexOf("const handleSaveDroppedLead");
    const fn = body.slice(start, body.indexOf("const handleLocateMe"));
    assert.ok(fn.indexOf("guardNewPinTerritory(") < fn.indexOf("saveManualLead("));
    assert.ok(fn.indexOf("guardNewPinTerritory(") < fn.indexOf("crypto.randomUUID()"));
    assert.match(fn, /isTerritoryWarningCancelled\(error\)/);
  });

  test("TC9 confirm continues the save", async () => {
    fresh();
    const result = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => true,
      deps: deps(),
    });
    assert.deepEqual(result, { checked: true, warned: true });
  });

  test("TC10 actor and tap time are captured before the check, GPS, and save", async () => {
    fresh();
    const map = read("app/components/LeadMap.tsx");
    const fn = map.slice(map.indexOf("const handleSaveDroppedLead"), map.indexOf("const handleLocateMe"));
    const acted = fn.indexOf("const actedAt = new Date()");
    const actor = fn.indexOf("const actorUid");
    const firstAwait = fn.indexOf("await ");
    const guardAt = fn.indexOf("guardNewPinTerritory(");
    assert.ok(acted >= 0 && actor >= 0 && firstAwait >= 0);
    assert.ok(acted < firstAwait && actor < firstAwait);
    assert.ok(acted < guardAt && actor < guardAt);
    assert.ok(guardAt < fn.indexOf("getLocation("));
    assert.ok(guardAt < fn.indexOf("bestFixInWindow("));
    assert.ok(guardAt < fn.indexOf("saveManualLead("));
    assert.match(fn, /leadData\.createdAt instanceof Date \? leadData\.createdAt : actedAt/);
    assert.match(fn, /auth\?\.currentUser\?\.uid \?\? currentUser\?\.id \?\? ''/);

    const tap = new Date("2026-11-10T19:00:00.000Z");
    let clock = tap.getTime();
    const guard = await guardNewPinTerritory({
      uid: UID,
      lat: PIN.lat,
      lng: PIN.lng,
      confirm: () => true,
      deps: deps({
        now: () => clock,
        send: async () => {
          clock += 1400;
          return jsonResponse(200, verdict({ warn: false, inOtherUsersTerritory: false, owners: [] }));
        },
      }),
    });
    assert.equal(guard.checked, true);
    assert.equal(clock - tap.getTime(), 1400);
    const times = pinSaveTimestamps({
      checked: guard.checked,
      actedAt: tap,
      placedAt: tap,
      manualDisposition: true,
      now: () => new Date(clock),
    });
    assert.equal(times.createdAt.getTime(), tap.getTime());
    assert.equal(times.dispositionedAt?.getTime(), tap.getTime());
    assert.equal(times.historyTimestamp.getTime(), tap.getTime());
    assert.notEqual(times.createdAt.getTime(), clock);
    const kept = new Date("2026-11-10T18:00:00.000Z");
    const explicit = pinSaveTimestamps({
      checked: true,
      actedAt: tap,
      placedAt: kept,
      dispositionedAt: kept,
      manualDisposition: true,
      now: () => new Date(clock),
    });
    assert.equal(explicit.createdAt.getTime(), kept.getTime());
    assert.equal(explicit.dispositionedAt?.getTime(), kept.getTime());
    assert.equal(explicit.historyTimestamp.getTime(), kept.getTime());
    const legacy = pinSaveTimestamps({
      checked: false,
      actedAt: tap,
      placedAt: tap,
      manualDisposition: true,
      now: () => new Date(clock),
    });
    assert.equal(legacy.createdAt.getTime(), clock);
    assert.equal(legacy.dispositionedAt?.getTime(), clock);
    assert.equal(legacy.historyTimestamp.getTime(), clock);
  });

  test("TC11 the request is the pin coordinate through apiFetch, never GPS", async () => {
    fresh();
    let sends = 0;
    let seen: { path?: string; init?: RequestInit } = {};
    const result = await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
      send: async (path, init) => {
        sends += 1;
        seen = { path, init };
        return jsonResponse(200, verdict({ warn: false, inOtherUsersTerritory: false, owners: [] }));
      },
    }));
    assert.equal(result?.warn, false);
    assert.equal(sends, 1);
    assert.equal(seen.path, TERRITORY_CHECK_PATH);
    assert.equal(seen.path, "/api/field/territory-check");
    assert.equal(seen.init?.method, "POST");
    assert.equal(seen.init?.body, JSON.stringify({ lat: PIN.lat, lng: PIN.lng }));
    assert.equal(String(seen.init?.body).includes(String(DEVICE_GPS.lat)), false);
    assert.equal(String(seen.init?.body).includes(String(DEVICE_GPS.lng)), false);
    const headers = new Headers(seen.init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(seen.init?.signal instanceof AbortSignal, true);

    const src = read("app/field/territoryCheck.ts");
    assert.match(src, /import \{ apiFetch \} from '@\/app\/utils\/apiFetch'/);
    assert.match(src, /deps\?\.send \?\? apiFetch/);
    assert.equal(src.includes("firebase/firestore"), false);
    assert.equal(src.includes("CapacitorHttp"), false);
    assert.equal(src.includes("getLocation"), false);
    assert.equal(src.includes("console."), false);
    assert.equal(/fetch\s*\(/.test(src), false);

    for (const lat of [91, -91, Number.NaN, Number.POSITIVE_INFINITY]) {
      fresh();
      let bad = 0;
      const outcome = await checkNewPinTerritory({ uid: UID, lat, lng: PIN.lng }, deps({
        send: async () => {
          bad += 1;
          return jsonResponse(200, verdict());
        },
      }));
      assert.equal(outcome, null);
      assert.equal(bad, 0, String(lat));
    }
    fresh();
    let badLng = 0;
    assert.equal(await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: 181 }, deps({
      send: async () => {
        badLng += 1;
        return jsonResponse(200, verdict());
      },
    })), null);
    assert.equal(badLng, 0);
    let emptySends = 0;
    let mismatchTokens = 0;
    assert.equal(await checkNewPinTerritory({ uid: "", lat: PIN.lat, lng: PIN.lng }, deps({
      send: async () => {
        emptySends += 1;
        return jsonResponse(200, verdict());
      },
    })), null);
    assert.equal(await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
      currentUid: () => "someone-else",
      getToken: async () => {
        mismatchTokens += 1;
        return TOKEN;
      },
      send: async () => {
        emptySends += 1;
        return jsonResponse(200, verdict());
      },
    })), null);
    assert.equal(emptySends, 0);
    assert.equal(mismatchTokens, 0);
  });

  test("TC12 token and uid never reach console", async () => {
    fresh();
    const spy = spyConsole();
    try {
      await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps({
        send: async () => {
          throw new Error(`down ${TOKEN} ${UID}`);
        },
      }));
      await checkNewPinTerritory({ uid: UID, lat: PIN.lat, lng: PIN.lng }, deps());
    } finally {
      spy.restore();
    }
    const text = spy.calls.join("\n");
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(UID), false);
    assert.equal(spy.calls.length, 0);
  });

  test("TC13 LeadMap no longer uses leadAtPoint and the export is gone", () => {
    assert.equal(read("app/components/LeadMap.tsx").includes("leadAtPoint"), false);
    assert.equal(read("app/mobile/_lib/ownerCounts.ts").includes("leadAtPoint"), false);
    assert.equal(read("app/components/LeadMap.tsx").includes("shouldWarnTerritory"), false);
    assert.equal(read("app/components/LeadMap.tsx").includes("callerPopupExempt"), false);
    assert.equal(read("app/components/LeadMap.tsx").includes("territoryOwnershipOn"), false);
  });

  test("B1 native geocode and route send the bearer next to the build headers", async () => {
    fresh();
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com";
    const provider = async () => TOKEN;
    await nativeApiFetch("/api/geocode?address=x", {}, async (request) => {
      assert.equal(headerValue(request.headers, "authorization"), `Bearer ${TOKEN}`);
      assert.equal(request.headers?.["X-Raydar-Build"], "168");
      assert.equal(request.headers?.["X-Raydar-Platform"], "ios");
      return nativeOk(request);
    }, "ios", provider);
    await nativeApiFetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints: [{ lat: 1, lng: 2 }] }),
    }, async (request) => {
      assert.equal(headerValue(request.headers, "authorization"), `Bearer ${TOKEN}`);
      assert.equal(request.headers?.["X-Raydar-Build"], "168");
      assert.equal(request.headers?.["X-Raydar-Platform"], "ios");
      assert.equal(request.method, "POST");
      assert.deepEqual(request.data, { waypoints: [{ lat: 1, lng: 2 }] });
      return nativeOk(request);
    }, "ios", provider);
    await nativeApiFetch("/api/geocode?address=x", {}, async (request) => {
      assert.equal(headerValue(request.headers, "authorization"), `Bearer ${TOKEN}`);
      assert.equal(request.headers?.["X-Raydar-Build"], "168");
      assert.equal(request.headers?.["X-Raydar-Platform"], "android");
      return nativeOk(request);
    }, "android", provider);
  });

  test("B2 a missing or failed token still sends the request once without Authorization", async () => {
    fresh();
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com";
    const cases: Array<() => Promise<string | null | undefined>> = [
      async () => {
        throw new Error(`reject ${TOKEN}`);
      },
      () => {
        throw new Error(`sync ${TOKEN}`);
      },
      async () => "",
      async () => null,
    ];
    for (const bearer of cases) {
      let sends = 0;
      const response = await nativeApiFetch("/api/geocode?address=x", {}, async (request) => {
        sends += 1;
        assert.equal(headerValue(request.headers, "authorization"), undefined);
        assert.equal(request.headers?.["X-Raydar-Build"], "168");
        assert.equal(request.headers?.["X-Raydar-Platform"], "ios");
        return nativeOk(request);
      }, "ios", bearer);
      assert.equal(response.status, 200);
      assert.equal(sends, 1);
    }
    await withFakeTimers(async (timers) => {
      let sends = 0;
      const pending = nativeApiFetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, async (request) => {
        sends += 1;
        assert.equal(headerValue(request.headers, "authorization"), undefined);
        assert.equal(request.headers?.["X-Raydar-Build"], "168");
        assert.equal(request.headers?.["X-Raydar-Platform"], "android");
        assert.deepEqual(request.data, {});
        return { status: 200, data: "{}", headers: {}, url: request.url };
      }, "android", () => new Promise(() => {}));
      timers.fire(BEARER_TOKEN_TIMEOUT_MS);
      const response = await pending;
      assert.equal(response.status, 200);
      assert.equal(sends, 1);
    });
  });

  test("B3 the bearer wait is capped at 1000ms and the timer is cleared", async () => {
    fresh();
    assert.equal(BEARER_TOKEN_TIMEOUT_MS, 1000);
    await withFakeTimers(async (timers) => {
      const pending = bearerForPath("/api/geocode", () => new Promise(() => {}));
      timers.fire(BEARER_TOKEN_TIMEOUT_MS);
      assert.equal(await pending, null);
    });
    await withFakeTimers(async (timers) => {
      assert.equal(await bearerForPath("/api/geocode", async () => TOKEN), TOKEN);
      assert.equal(timers.pending(), 0);
      assert.ok(timers.cleared() >= 1);
    });
    const started = Date.now();
    assert.equal(await bearerForPath("/api/route", () => new Promise(() => {}), 20), null);
    assert.ok(Date.now() - started < 500);
  });

  test("B4 bearer is only added for the exact geocode and route paths", async () => {
    fresh();
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com";
    assert.equal(wantsBearer("/api/geocode?address=x"), true);
    assert.equal(wantsBearer("/api/geocode#frag"), true);
    assert.equal(wantsBearer("/api/route"), true);
    assert.equal(wantsBearer("/api/geocode-x"), false);
    assert.equal(wantsBearer("/api/routes"), false);
    assert.equal(wantsBearer("/api/solar"), false);
    for (const pathName of ["/api/field/dispo", "/api/mobile-leads", "/api/solar", "/api/debug-log", "/api/geocode-x", "/api/routes"]) {
      let reads = 0;
      await nativeApiFetch(pathName, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, async (request) => {
        assert.equal(headerValue(request.headers, "authorization"), undefined, pathName);
        return nativeOk(request);
      }, "ios", async () => {
        reads += 1;
        return TOKEN;
      });
      assert.equal(reads, 0, pathName);
      assert.equal(await bearerForPath(pathName, async () => {
        reads += 1;
        return TOKEN;
      }), null);
      assert.equal(reads, 0, pathName);
    }
    for (const headers of [
      { Authorization: "Bearer caller-supplied" } as Record<string, string>,
      { authorization: "Bearer caller-supplied" } as Record<string, string>,
    ]) {
      let reads = 0;
      const init = { headers: { ...headers } };
      await nativeApiFetch("/api/geocode?address=x", init, async (request) => {
        assert.equal(headerValue(request.headers, "authorization"), "Bearer caller-supplied");
        return nativeOk(request);
      }, "ios", async () => {
        reads += 1;
        return TOKEN;
      });
      assert.equal(reads, 0);
      assert.equal(JSON.stringify(init.headers), JSON.stringify(headers));
    }
  });

  test("B5 a token in a provider error is not logged or copied onto the response", async () => {
    fresh();
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com";
    const spy = spyConsole();
    try {
      const leaked = `secret-${TOKEN}`;
      const failed = await nativeApiFetch("/api/geocode?address=x", {}, async (request) => {
        assert.equal(headerValue(request.headers, "authorization"), undefined);
        return { status: 200, data: '{"ok":true}', headers: { "content-type": "application/json" }, url: request.url };
      }, "ios", async () => {
        throw new Error(`firebase failed ${leaked}`);
      });
      const ok = await nativeApiFetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, async (request) => {
        return { status: 200, data: '{"ok":true}', headers: { "x-request": "no" }, url: request.url };
      }, "ios", async () => leaked);
      for (const response of [failed, ok]) {
        const body = await response.text();
        const dumped = `${response.status} ${body} ${JSON.stringify([...(new Headers(response.headers)).entries()])}`;
        assert.equal(dumped.includes(leaked), false);
        assert.equal(dumped.includes(TOKEN), false);
      }
      const text = spy.calls.join("\n");
      assert.equal(text.includes(leaked), false);
      assert.equal(text.includes(TOKEN), false);
    } finally {
      spy.restore();
    }
    assert.equal(read("app/utils/apiFetch.ts").includes("console."), false);
  });

  test("B6 non-api paths still throw and the web branch does not add a bearer", async () => {
    fresh();
    assert.throws(() => resolveApiUrl("https://evil.example/api/users", "https://example.com"));
    assert.throws(() => resolveApiUrl("/login", "https://example.com"));
    const init = { method: "GET" };
    const response = new Response("{}", { status: 200 });
    const original = globalThis.fetch;
    let seen: { path?: unknown; options?: unknown } = {};
    globalThis.fetch = async (pathName, options) => {
      seen = { path: pathName, options };
      return response;
    };
    try {
      assert.equal(await apiFetch("/api/geocode?address=x", init), response);
      assert.equal(seen.path, "/api/geocode?address=x");
      assert.equal(seen.options, init);
    } finally {
      globalThis.fetch = original;
    }
    const src = read("app/utils/apiFetch.ts");
    const web = src.slice(src.indexOf("export async function apiFetch"), src.indexOf("export async function nativeApiFetch"));
    assert.match(web, /return fetch\(path, init\)/);
    assert.equal(web.includes("bearerForPath"), false);
    assert.equal(web.includes("Authorization"), false);
    assert.match(src, /bearer: BearerTokenProvider = defaultBearerToken/);
  });

  test("B7 every geocode and route caller goes through apiFetch and not authedFetch or bare fetch", () => {
    const sites = [
      ["app/mobile/knocking/page.tsx", "/api/geocode"],
      ["app/mobile/territories/PlaceSearch.tsx", "/api/geocode"],
      ["app/components/LeadMap.tsx", "/api/geocode"],
      ["app/components/RouteBuilder.tsx", "/api/route"],
      ["app/utils/geocode.ts", "/api/geocode"],
      ["app/page.tsx", "/api/geocode"],
    ] as const;
    for (const [file, route] of sites) {
      const source = read(file);
      assert.match(source, /import \{ apiFetch \} from ['"]@\/app\/utils\/apiFetch['"]/, file);
      assert.match(source, /apiFetch\(/, file);
      assert.ok(source.includes(route), file);
      assert.equal(source.includes("authedFetch"), false, file);
      assert.equal(/(?<![\w.])fetch\(\s*[`'"]\/api\/(?:geocode|route)/.test(source), false, file);
    }
  });

  test("L2 ownership fields move across snapshots only while a territory session exists", () => {
    fresh();
    const withFields = pin({
      ownedByMe: false,
      owners: [{ uid: "owner-1", name: "Pat L." }],
      ownerSource: "territory",
      expiredGoBack: true,
      inOtherUsersTerritory: true,
      dispositionedAt: new Date("2026-11-10T18:00:00.000Z"),
    });
    const withoutFields = pin({ dispositionedAt: new Date("2026-11-10T19:00:00.000Z") });
    for (const [first, second] of [[withFields, withoutFields], [withoutFields, withFields]] as const) {
      fresh();
      const [merged] = mergeLeadSnapshots([first], [second]);
      assert.equal(merged.ownedByMe, undefined);
      assert.equal(merged.owners, undefined);
      assert.equal(merged.ownerSource, undefined);
      assert.equal(merged.expiredGoBack, undefined);
      assert.equal(merged.inOtherUsersTerritory, undefined);
    }
    fresh();
    noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: false });
    const [carried] = mergeLeadSnapshots([withFields], [withoutFields]);
    assert.equal(carried.ownedByMe, false);
    assert.equal(carried.owners?.[0]?.name, "Pat L.");
    assert.equal(carried.ownerSource, "territory");
    assert.equal(carried.expiredGoBack, true);
    assert.equal(carried.inOtherUsersTerritory, true);
    const [otherOrder] = mergeLeadSnapshots([withoutFields], [withFields]);
    assert.equal(otherOrder.ownedByMe, false);
    assert.equal(otherOrder.inOtherUsersTerritory, true);
    fresh();
    noteMobileLeadsMeta(UID, { ownership: "legacy", popupExempt: false });
    const [legacy] = mergeLeadSnapshots([withFields], [withoutFields]);
    assert.equal(legacy.ownedByMe, undefined);
    assert.equal(legacy.inOtherUsersTerritory, undefined);
    fresh();
    assert.equal(anyTerritoryOwnership(), false);
    noteMobileLeadsMeta(UID, { ownership: "legacy", popupExempt: false });
    assert.equal(anyTerritoryOwnership(), false);
    noteMobileLeadsMeta("other", { ownership: "territory", popupExempt: true });
    assert.equal(anyTerritoryOwnership(), true);
    resetOwnerCountsForTests();
    assert.equal(anyTerritoryOwnership(), false);
    const owner = read("app/mobile/_lib/ownerCounts.ts");
    assert.deepEqual(owner.split("\n").filter((line) => line.startsWith("import ")), [
      'import type { Lead } from "@/app/types";',
      'import { isCountedKnock, knockInstant } from "@/app/utils/knockCount";',
    ]);
    assert.equal(read("app/utils/knockCount.ts").includes("houseIdentity"), false);
    assert.match(read("app/homeowners/houseIdentity.ts"), /if \(!anyTerritoryOwnership\(\)\) return winner;/);
  });

  test("L7 takeCountedToast takes only the draft id", () => {
    fresh();
    assert.equal(takeCountedToast.length, 1);
    assert.equal(takeCountedToast("draft-1"), true);
    assert.equal(takeCountedToast("draft-1"), false);
    assert.equal(takeCountedToast("draft-2"), true);
    for (const file of [...filesUnder(path.join(root, "app")), ...filesUnder(path.join(root, "tests"))]) {
      const source = readFileSync(file, "utf8");
      assert.equal(/takeCountedToast\([^)\n]*,/.test(source), false, path.relative(root, file));
    }
    assert.equal(read("app/mobile/_lib/ownerCounts.ts").includes("_duplicate"), false);
  });

  test("V1 release 14.24 build 168 matches across the app, iOS and Android", () => {
    assert.equal(release.version, "14.24");
    assert.equal(release.build, 168);
    const project = read("ios/App/App.xcodeproj/project.pbxproj");
    assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]), ["14.24", "14.24"]);
    assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ["168", "168"]);
    const gradle = read("android/app/build.gradle");
    assert.match(gradle, /versionName "14\.24"/);
    assert.match(gradle, /versionCode 168\b/);
    assert.match(read("tests/mobile/silent-sync-v1418.test.ts"), /X-Raydar-Build"\], "168"/);
  });

  test("V2 knockCount.ts is unchanged and the diff stays off the server", () => {
    const hash = createHash("sha256").update(readFileSync(path.join(root, "app/utils/knockCount.ts"))).digest("hex");
    assert.equal(hash, "a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226");
    const names = new Set<string>();
    for (const command of [
      `git diff --name-only ${BASE}`,
      `git diff --cached --name-only ${BASE}`,
      `git diff --name-only ${BASE} HEAD`,
      "git ls-files --others --exclude-standard",
    ]) {
      const output = execSync(command, { cwd: root, encoding: "utf8" });
      for (const line of output.split("\n")) if (line) names.add(line);
    }
    const forbidden = (name: string) => name.startsWith("app/api/")
      || name.startsWith("app/utils/server/")
      || name.startsWith("scripts/")
      || name === "firestore.rules"
      || name === "firestore.indexes.json"
      || name === "app/page.tsx"
      || name === "app/utils/knockCount.ts"
      || (name.startsWith("ios/") && name !== "ios/App/App.xcodeproj/project.pbxproj")
      || (name.startsWith("android/") && name !== "android/app/build.gradle");
    for (const name of names) assert.equal(forbidden(name), false, name);
  });
});
