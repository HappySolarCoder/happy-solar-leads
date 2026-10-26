import type { Lead } from "@/app/types";

/** The contact editor's fields. Notes are included only when the rep changed them. */
export type ContactForm = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  estimatedBill: string | number;
  notes: string;
};

const TEXT_KEYS = ["name", "address", "city", "state", "zip", "phone", "email", "notes"] as const;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function bill(value: string | number | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Contact fields for a full save. Notes are included only when the editor changed them. */
export function contactSaveFields(lead: Lead, form: ContactForm): Partial<Lead> {
  const patch: Partial<Lead> = {
    name: form.name,
    address: form.address,
    city: form.city,
    state: form.state,
    zip: form.zip,
    phone: form.phone || "",
    email: form.email || "",
  };
  const nextBill = bill(form.estimatedBill);
  if (nextBill != null) patch.estimatedBill = nextBill;
  if ((form.notes || "") !== (lead.notes || "")) patch.notes = form.notes || "";
  return patch;
}

/** Fields whose editor values differ from the lead. Null when the save would be a no-op. */
export function changedContactPatch(lead: Lead, form: ContactForm): Partial<Lead> | null {
  const patch: Partial<Lead> = {};
  for (const key of TEXT_KEYS) {
    const next = text(form[key]);
    if (next === text(lead[key])) continue;
    patch[key] = next;
  }
  const nextBill = bill(form.estimatedBill);
  if (nextBill !== lead.estimatedBill && !(nextBill == null && lead.estimatedBill == null)) {
    if (nextBill != null) patch.estimatedBill = nextBill;
  }
  return Object.keys(patch).length ? patch : null;
}

/** Direct editor save. When notes are over the limit, contact fields still save and notes do not. */
export function editorSavePatch(lead: Lead, form: ContactForm, notesBlocked = false): Partial<Lead> | null {
  const source = notesBlocked ? { ...form, notes: lead.notes || "" } : form;
  return changedContactPatch(lead, source);
}

/**
 * Office full-document save. The form's notes are not copied onto the lead
 * unless the rep changed them, so an unchanged note is not blanked.
 */
export function officeLeadSave(lead: Lead, form: ContactForm): Lead {
  const fields = contactSaveFields(lead, form);
  return {
    ...lead,
    name: form.name,
    address: form.address,
    city: form.city,
    state: form.state,
    zip: form.zip,
    phone: form.phone || undefined,
    email: form.email || undefined,
    estimatedBill: form.estimatedBill === "" || form.estimatedBill == null ? undefined : Number(form.estimatedBill),
    ...fields,
  };
}
