/**
 * Runs the contact-save matrix inputs against 14.17's directPatch and
 * reportingPatch from 053ae9e. The disposition route did not exist for
 * contact or photo fields. A permission-denied write was blocked on the phone.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Baseline1417Input = {
  patch: Record<string, unknown>;
  leadNotes: string;
  deny: boolean;
};

type SaveFns = {
  directPatch: (patch: Record<string, unknown>) => Record<string, unknown>;
  reportingPatch: (m: Record<string, unknown>, user: { id: string; name: string }) => Record<string, unknown>;
};

let saved: SaveFns | null = null;

export async function load1417SaveFns(): Promise<SaveFns> {
  if (saved) return saved;
  const dir = mkdtempSync(path.join(tmpdir(), "raydar-1417-"));
  const source = execFileSync("git", ["show", "053ae9e:app/field/directWrites.ts"], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
    encoding: "utf8",
  });
  const rewritten = source
    .replaceAll("from 'firebase/firestore'", "from './firebase-stub'")
    .replaceAll("from '@/app/utils/firebase'", "from './firebase-stub'")
    .replaceAll("from '@/app/types'", "from './types-stub'")
    .replaceAll("from './types'", "from './types-stub'")
    .replaceAll("from '@/app/utils/firestore'", "from './firebase-stub'")
    .replaceAll("from './createLeadOnce'", "from './firebase-stub'")
    .replaceAll("from 'geofire-common'", "from './firebase-stub'");
  writeFileSync(path.join(dir, "directWrites.ts"), rewritten);
  writeFileSync(path.join(dir, "firebase-stub.ts"), `
    export class Timestamp { static fromDate(date: Date) { return { toDate: () => date }; } }
    export const auth = { currentUser: { uid: "rep-b" } };
    export const db = {};
    export function doc() { return {}; }
    export function runTransaction() { throw new Error("unused"); }
    export function mapLeadDoc(value: unknown) { return value; }
    export async function createLeadOnce() { return false; }
    export function distanceBetween() { return 0; }
  `);
  writeFileSync(path.join(dir, "types-stub.ts"), "export type Lead = Record<string, unknown>; export type User = { id: string; name: string }; export type PendingMutation = Record<string, unknown>;\n");
  const loaded = await import(pathToFileURL(path.join(dir, "directWrites.ts")).href) as SaveFns;
  saved = loaded;
  return loaded;
}

/** The queued shape 14.17 enqueueDirect stored for a non-knock patch. */
export function mutation1417(input: Baseline1417Input) {
  return {
    id: "draft-1417",
    userId: "rep-b",
    userName: "Owner",
    leadId: "lead-1",
    createdAt: "2026-10-26T12:00:00.000Z",
    kind: "notes" as const,
    baseStatus: "claimed",
    baseNotes: input.leadNotes || "",
    direct: { patch: input.patch },
  };
}

export async function result1417(input: Baseline1417Input): Promise<string> {
  if (input.deny) return "baseline: blocked draft, no write";
  const fns = await load1417SaveFns();
  const clean = fns.directPatch(input.patch);
  const payload = fns.reportingPatch(mutation1417({ ...input, patch: clean }), { id: "rep-b", name: "Owner" });
  const notesUntouched = !Object.prototype.hasOwnProperty.call(input.patch, "notes");
  if (notesUntouched && Object.prototype.hasOwnProperty.call(payload, "notes") && payload.notes !== input.leadNotes) {
    return `baseline: wrote notes ${JSON.stringify(payload.notes)}`;
  }
  for (const [key, value] of Object.entries(clean)) {
    if (key === "notes") continue;
    if (JSON.stringify(payload[key]) !== JSON.stringify(value)) {
      return `baseline: dropped ${key}`;
    }
  }
  if (!notesUntouched && payload.notes !== input.patch.notes) return "baseline: notes were not saved";
  return "pass";
}
