import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EmpowerBumpForm from "../../app/components/EmpowerBumpForm";
import {
  buildEmpowerBumpPayload,
  isValidEmpowerEmail,
  normalizeEmpowerZip,
  resolveEmpowerZip,
  zipFromText,
  type EmpowerBumpPayload,
} from "../../app/empower/bumpLogic";
import { homeownerVisitDraft } from "../../app/homeowners/visit";
import type { Homeowner } from "../../app/homeowners/model";
import { parseHomeowner } from "../../app/homeowners/model";
import type { Lead, User } from "../../app/types";
import type { EmpowerOutcome } from "../../app/empower/empowerBump";

function person(): User {
  return {
    id: "setter-1",
    name: "Setter",
    email: "setter@example.test",
    color: "#476E88",
    role: "setter",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function door(patch: Partial<Lead> = {}): Lead {
  return {
    id: "door-1",
    name: "Ada Lovelace",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "555-0100",
    email: "ada@example.test",
    status: "not-home",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...patch,
  } as Lead;
}

function home(patch: Partial<Homeowner> = {}): Homeowner {
  return {
    id: "home-1",
    address: "10 Main St",
    addressNorm: "10 MAIN ST",
    municipality: "Buffalo",
    state: "NY",
    ownerName: "Ada Lovelace",
    occupancyStatus: "Owner-Occupied",
    mailingCity: "Buffalo",
    mailingZip: "",
    propertyType: "Single Family",
    lat: 42.88,
    lng: -78.87,
    geohash: "dpsb9wxyz",
    geohash5: "dpsb9",
    ...patch,
  };
}

function baseInput(patch: Record<string, unknown> = {}) {
  return {
    draftId: "draft-zip",
    actedAt: "2026-11-23T19:00:00.000Z",
    leadId: "door-1",
    name: "Ada Lovelace",
    phone: "555-555-0100",
    email: "ada@example.test",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    county: "Erie",
    householdSize: 1,
    estimatedBand: "not_sure" as const,
    assistancePrograms: [] as string[],
    assistanceNone: true,
    confirmedContact: true,
    ...patch,
  };
}

function markupFor(lead: Lead, homeowner?: Homeowner) {
  return renderToStaticMarkup(createElement(EmpowerBumpForm, {
    lead,
    homeowner,
    onClose: () => {},
    onSubmit: async (): Promise<EmpowerOutcome> => ({ status: "sent", attempted: true }),
  }));
}

test("normalizeEmpowerZip handles ZIP, ZIP+4, 9 digits, and lost leading zeros only in zero-prefix states", () => {
  assert.equal(normalizeEmpowerZip("14201", "NY"), "14201");
  assert.equal(normalizeEmpowerZip("14201-6789", "NY"), "14201-6789");
  assert.equal(normalizeEmpowerZip("142016789", "NY"), "14201-6789");
  assert.equal(normalizeEmpowerZip(" 14201 6789 ", "NY"), "14201-6789");
  assert.equal(normalizeEmpowerZip(14201, "NY"), "14201");
  assert.equal(normalizeEmpowerZip(7051, "NJ"), "07051");
  assert.equal(normalizeEmpowerZip("7051", "nj"), "07051");
  assert.equal(normalizeEmpowerZip(2101, "MA"), "02101");
  // NY ZIPs start with 1. A 4-digit number is not a lost leading zero.
  assert.equal(normalizeEmpowerZip(4201, "NY"), "");
  assert.equal(normalizeEmpowerZip("4201", "NY"), "");
  assert.equal(normalizeEmpowerZip("", "NY"), "");
  assert.equal(normalizeEmpowerZip("12", "NJ"), "00012");
});

test("zipFromText reads a ZIP at the end of a postal address and skips a house number", () => {
  assert.equal(zipFromText("123 Main St, Buffalo, NY 14201", "NY"), "14201");
  assert.equal(zipFromText("123 Main St, Buffalo, NY 14201-1234", "NY"), "14201-1234");
  assert.equal(zipFromText("12345 Main St", "NY"), "");
  assert.equal(zipFromText("10 Main St, Newark, NJ 07051", "NJ"), "07051");
});

test("resolveEmpowerZip reads each lead and homeowner source", () => {
  assert.equal(resolveEmpowerZip({ zip: "14201", state: "NY" }), "14201");
  assert.equal(resolveEmpowerZip({ zip: 14201, state: "NY" }), "14201");
  assert.equal(resolveEmpowerZip({ postalCode: "14201", state: "NY", zip: "" }), "14201");
  assert.equal(resolveEmpowerZip({ zipCode: "14201-1234", state: "NY" }), "14201-1234");
  assert.equal(resolveEmpowerZip({ zipcode: "142016789", state: "NY" }), "14201-6789");
  assert.equal(resolveEmpowerZip({
    zip: "",
    address: "123 Main St, Buffalo, NY 14201",
    city: "Buffalo",
    state: "NY",
  }), "14201");
  assert.equal(resolveEmpowerZip({
    zip: "",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    homeowner: { address: "10 Main St, Buffalo, NY 14201", state: "NY" },
  }), "14201");
  assert.equal(resolveEmpowerZip({
    zip: "",
    address: "10 Main St",
    state: "NY",
    homeowner: { addressNorm: "10 MAIN ST BUFFALO NY 14201-1234", state: "NY" },
  }), "14201-1234");
  assert.equal(resolveEmpowerZip({
    zip: "",
    address: "10 Main St",
    state: "NY",
    homeowner: { mailingZip: "14201", state: "NY" },
  }), "14201");
  assert.equal(resolveEmpowerZip({
    zip: "",
    address: "10 Main St",
    state: "NJ",
    homeowner: { mailingZip: 7051, state: "NJ" },
  }), "07051");
  // A ZIP in the property address wins over mailing ZIP.
  assert.equal(resolveEmpowerZip({
    zip: "",
    address: "10 Main St, Buffalo, NY 14201",
    state: "NY",
    homeowner: { mailingZip: "99999", state: "NY" },
  }), "14201");
  assert.equal(resolveEmpowerZip({ zip: "", address: "10 Main St", state: "NY" }), "");
});

test("a manual pin uses lead.zip, and a homeowner pin uses property data even when the visit draft left zip empty", () => {
  const manual = door({ zip: "14201" });
  assert.equal(resolveEmpowerZip(manual), "14201");
  assert.equal(markupFor(manual).includes('aria-label="ZIP"'), false);
  assert.equal(markupFor(manual).includes("14201"), true);

  const manualFromAddress = door({ zip: "", address: "123 Main St, Buffalo, NY 14201" });
  assert.equal(resolveEmpowerZip(manualFromAddress), "14201");
  assert.equal(markupFor(manualFromAddress).includes('aria-label="ZIP"'), false);

  const record = home({ mailingZip: "14201" });
  const visit = homeownerVisitDraft(record, person(), "visit-1");
  assert.equal(visit.zip, "");
  assert.equal(resolveEmpowerZip({ ...visit, homeowner: record }), "14201");
  const homeownerMarkup = markupFor(visit, record);
  assert.equal(homeownerMarkup.includes('aria-label="ZIP"'), false);
  assert.equal(homeownerMarkup.includes("14201"), true);

  const addressHome = home({ mailingZip: "", address: "10 Main St, Buffalo, NY 14201" });
  const addressVisit = homeownerVisitDraft(addressHome, person(), "visit-2");
  assert.equal(resolveEmpowerZip({ ...addressVisit, homeowner: addressHome }), "14201");

  const missing = door({ zip: "", address: "10 Main St" });
  assert.equal(resolveEmpowerZip(missing), "");
  assert.equal(markupFor(missing).includes('aria-label="ZIP"'), true);
});

test("parseHomeowner keeps a numeric mailing ZIP so the bump can read it", () => {
  const parsed = parseHomeowner("home-1", {
    lat: 42.88,
    lng: -78.87,
    geohash: "dpsb9wxyz",
    address: "10 Main St",
    municipality: "Buffalo",
    state: "NY",
    mailingZip: 14201,
  });
  assert.ok(parsed);
  assert.equal(parsed?.mailingZip, "14201");
  assert.equal(resolveEmpowerZip({ zip: "", state: "NY", homeowner: parsed }), "14201");
});

test("a bump save uses the resolved ZIP and still blocks a truly missing one", () => {
  const fromLead = buildEmpowerBumpPayload(baseInput({
    zip: resolveEmpowerZip(door({ zip: 14201 as unknown as string })),
  }));
  assert.equal(fromLead.ok, true);
  if (fromLead.ok) assert.equal(fromLead.payload.zip, "14201");

  const fromAddress = buildEmpowerBumpPayload(baseInput({
    zip: resolveEmpowerZip(door({ zip: "", address: "123 Main St, Buffalo, NY 14201-1234" })),
  }));
  assert.equal(fromAddress.ok, true);
  if (fromAddress.ok) assert.equal(fromAddress.payload.zip, "14201-1234");

  const missing = buildEmpowerBumpPayload(baseInput({ zip: "" }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.message, /ZIP \(5 digits or ZIP\+4\)/);
});

test("email is required, trimmed, and accepts plus signs, subdomains, and long TLDs", () => {
  assert.equal(isValidEmpowerEmail("ada@example.test"), true);
  assert.equal(isValidEmpowerEmail("  ada+tag@mail.example.photography  "), true);
  assert.equal(isValidEmpowerEmail("ADA@Example.TEST"), true);
  assert.equal(isValidEmpowerEmail(""), false);
  assert.equal(isValidEmpowerEmail("   "), false);
  assert.equal(isValidEmpowerEmail("not-an-email"), false);
  assert.equal(isValidEmpowerEmail("ada@localhost"), false);
  assert.equal(isValidEmpowerEmail("ada @example.test"), false);

  const blank = buildEmpowerBumpPayload(baseInput({ email: "" }));
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.match(blank.message, /Email/);

  const built = buildEmpowerBumpPayload(baseInput({ email: "  ada+field@mail.example.photography  " }));
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.payload.email, "ada+field@mail.example.photography");
    const payload: EmpowerBumpPayload = built.payload;
    assert.equal(payload.email.length > 0, true);
  }

  const form = markupFor(door({ email: "" }));
  assert.equal(form.includes("(NO FAKE EMAILS)"), true);
  assert.equal(form.includes("Email (optional)"), false);
});
