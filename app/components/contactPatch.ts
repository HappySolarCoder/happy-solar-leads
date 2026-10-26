import type { Lead } from "@/app/types";

/** The contact editor's fields. Notes ride along with the contact save. */
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
