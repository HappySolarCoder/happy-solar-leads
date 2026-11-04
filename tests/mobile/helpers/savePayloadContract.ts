import { Timestamp } from "firebase/firestore";
import { buildLeadSaveDrafts } from "../../../app/field/contactSave";
import { commitDirectMutation, reportingPatch, type DirectCommitIo } from "../../../app/field/directWrites";
import { knockPatch } from "../../../app/field/knockPatch";
import { deliverFieldDispo, fieldDispoBody, FIELD_DISPO_PATH } from "../../../app/field/serverDispo";
import type { PendingMutation } from "../../../app/field/types";
import { hotClaimBody, queueHotClaim, queueHotKnock, queueHotNotes } from "../../../app/hotLeads/save";
import type { HotLeadPin } from "../../../app/hotLeads/model";
import type { Lead, User } from "../../../app/types";

const at = new Date("2026-10-30T15:04:00.000Z");
const user: User = {
  id: "rep-1",
  name: "Riley Example",
  email: "riley@example.com",
  color: "#335364",
  role: "closer",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  approved: true,
  approvalStatus: "approved",
  isActive: true,
  status: "active",
} as User;

function lead(id = "lead-1"): Lead {
  return {
    id,
    name: "Pat Example",
    address: "100 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    phone: "555-0100",
    email: "pat@example.com",
    status: "claimed",
    notes: "existing note",
    claimedBy: user.id,
    createdAt: at,
    lat: 43.16,
    lng: -77.61,
  } as Lead;
}

function pin(): HotLeadPin {
  return {
    id: "ghl_opp_example_1",
    lat: 43.161,
    lng: -77.611,
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    contacts: [{ name: "Alex Example", phone: "555-0199", email: "alex@example.com" }],
    hotStatus: "active",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
    status: null,
    disposition: null,
    dispositionedAt: null,
    notes: "existing note",
    linkedLeadId: null,
    homeownerId: null,
  };
}

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Date) return { __date: item.toISOString() };
    if (item instanceof Timestamp) return { __timestamp: item.toDate().toISOString() };
    return item;
  });
}

function refusal(error: unknown): { status?: number; code?: string; reasonCode?: string } {
  const row = error as { status?: number; code?: string; reasonCode?: string };
  const out: { status?: number; code?: string; reasonCode?: string } = {};
  if (row.status !== undefined) out.status = row.status;
  if (row.code !== undefined) out.code = row.code;
  if (row.reasonCode !== undefined) out.reasonCode = row.reasonCode;
  return out;
}

async function directWrite(draft: PendingMutation) {
  const updates: string[] = [];
  const io = {
    db: {},
    auth: { currentUser: { uid: user.id } },
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    runTransaction: async (_db: unknown, fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>) => fn({
      get: async () => ({ exists: () => true, data: () => ({ ...lead(draft.leadId), notes: "existing note" }) }),
      update: (ref, data) => { updates.push(encode({ path: ref.path, data })); },
    }),
  } as unknown as DirectCommitIo;
  try {
    await commitDirectMutation(draft, user, io);
    return { updates, refused: null as ReturnType<typeof refusal> | null, patch: encode(reportingPatch(draft, user)) };
  } catch (error) {
    let patch: string | null = null;
    try { patch = encode(reportingPatch(draft, user)); } catch { patch = null; }
    return { updates, refused: refusal(error), patch };
  }
}

async function routeWrite(draft: PendingMutation) {
  const posts: { path: string; body: string }[] = [];
  try {
    const built = draft.kind === "claim" ? hotClaimBody(draft) : fieldDispoBody(draft, user);
    posts.push({
      path: draft.kind === "claim" ? "/api/hot-leads/claim" : FIELD_DISPO_PATH,
      body: JSON.stringify(built),
    });
    return { posts, refused: null as ReturnType<typeof refusal> | null };
  } catch (error) {
    return { posts, refused: refusal(error) };
  }
}

async function delivered(draft: PendingMutation) {
  const posts: { path: string; body: string }[] = [];
  try {
    await deliverFieldDispo(draft, user, {
      getToken: async () => "token",
      commit: async () => { throw Object.assign(Error("direct"), { status: 500, code: "direct-not-used" }); },
      post: async (path, init) => {
        posts.push({ path, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    return { posts, refused: null as ReturnType<typeof refusal> | null };
  } catch (error) {
    return { posts, refused: refusal(error) };
  }
}

function knockDraft(status: string, disposition: string, extra: Partial<Lead> = {}, hot = false): PendingMutation {
  const row = lead(hot ? "ghl_opp_example_1" : "lead-1");
  const patch = knockPatch(row, user, user.id, { id: status, name: disposition }, at, extra);
  return {
    id: `draft-${status}`,
    userId: user.id,
    userName: user.name,
    leadId: row.id,
    createdAt: at.toISOString(),
    kind: "knock",
    baseStatus: row.status,
    baseNotes: row.notes || "",
    status,
    disposition,
    ...(hot ? { collection: "hotLeads" as const } : {}),
    direct: { patch },
  };
}

const hot = pin();
const cases: Record<string, { leads?: PendingMutation; hot?: PendingMutation | null }> = {};

cases.knock = {
  leads: knockDraft("not-home", "Not Home", {
    knockGpsLat: 43.1601,
    knockGpsLng: -77.6101,
    knockGpsAccuracy: 8,
    knockGpsTimestamp: at,
  }),
  hot: queueHotKnock({
    enabled: true,
    user,
    pin: hot,
    draftId: "draft-hot-knock",
    tappedAt: at,
    status: "not-home",
    disposition: "Not Home",
    gps: { lat: 43.1601, lng: -77.6101, accuracyM: 8, capturedAt: at.toISOString() },
  }),
};

cases.dispo = {
  leads: knockDraft("appointment", "Appointment Set"),
  hot: queueHotKnock({
    enabled: true, user, pin: hot, draftId: "draft-hot-dispo", tappedAt: at,
    status: "appointment", disposition: "Appointment Set",
  }),
};

const notesBuilt = buildLeadSaveDrafts({
  lead: lead(),
  patch: { notes: "updated note" },
  actor: user,
  createdAt: at.toISOString(),
  ids: { notes: "draft-notes" },
});
cases.notes = {
  leads: notesBuilt.drafts[0],
  hot: queueHotNotes({
    enabled: true, user, pin: hot, draftId: "draft-hot-notes", tappedAt: at,
    notes: "updated note", baseNotes: "existing note",
  }),
};

const contactBuilt = buildLeadSaveDrafts({
  lead: lead(),
  patch: { phone: "555-0111", email: "next@example.com" },
  actor: user,
  createdAt: at.toISOString(),
  ids: { contact: "draft-contact" },
});
cases.contact = {
  leads: contactBuilt.drafts[0],
  hot: {
    ...contactBuilt.drafts[0],
    id: "draft-hot-contact",
    leadId: hot.id,
    collection: "hotLeads",
  },
};

function claimDraft(action: "claim" | "release", hotLead: boolean): PendingMutation {
  return {
    id: hotLead ? `draft-hot-${action}` : `draft-lead-${action}`,
    userId: user.id,
    userName: user.name,
    leadId: hotLead ? hot.id : "lead-1",
    createdAt: at.toISOString(),
    kind: "claim",
    claimAction: action,
    baseStatus: "claimed",
    ...(hotLead ? { collection: "hotLeads" as const } : {}),
  };
}
cases.claim = {
  leads: claimDraft("claim", false),
  hot: queueHotClaim({ enabled: true, user, pin: hot, draftId: "draft-hot-claim", tappedAt: at, action: "claim" }),
};
cases.release = {
  leads: claimDraft("release", false),
  hot: queueHotClaim({ enabled: true, user, pin: hot, draftId: "draft-hot-release", tappedAt: at, action: "release" }),
};

cases["go-back"] = {
  leads: knockDraft("go-back", "Go Back", {
    goBackScheduledDate: new Date("2026-11-02T15:00:00.000Z"),
    goBackScheduledTime: "16:30",
    goBackNotes: "come back after work",
  }),
  hot: knockDraft("go-back", "Go Back", {
    goBackScheduledDate: new Date("2026-11-02T15:00:00.000Z"),
    goBackScheduledTime: "16:30",
    goBackNotes: "come back after work",
  }, true),
};

cases.objection = {
  leads: knockDraft("not-interested", "Not Interested", {
    objectionType: "cost",
    objectionNotes: "price",
  } as unknown as Partial<Lead>),
  hot: knockDraft("not-interested", "Not Interested", {
    objectionType: "cost",
    objectionNotes: "price",
  } as unknown as Partial<Lead>, true),
};

/** Exact direct-write patch and /api/field/dispo (or claim) body for every save type. */
export async function captureSavePayloads(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, pair] of Object.entries(cases)) {
    const entry: Record<string, unknown> = {};
    for (const side of ["leads", "hot"] as const) {
      const draft = pair[side];
      if (!draft) continue;
      entry[side] = {
        direct: await directWrite(draft),
        route: await routeWrite(draft),
        delivered: await delivered(draft),
      };
    }
    out[name] = entry;
  }
  return out;
}
