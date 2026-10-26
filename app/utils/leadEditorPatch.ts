/**
 * Partial write for the scheduling-manager lead editor.
 * Only keys whose values actually differ are returned, so a manager can fill
 * one missing contact field on a lead they do not own. Null means "remove
 * this optional field" (the caller turns that into FieldValue.delete()).
 *
 * The nine fields are name, address, city, state, zip, phone, email,
 * estimatedBill, and notes.
 */
export type LeadEditorForm = {
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

export type LeadContactSnapshot = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  estimatedBill?: number | null;
  notes?: string | null;
};

export type LeadEditorPatch = {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string | null;
  email?: string | null;
  estimatedBill?: number | null;
  notes?: string | null;
};

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

export function buildLeadEditorPatch(lead: LeadContactSnapshot, form: LeadEditorForm): LeadEditorPatch {
  const patch: LeadEditorPatch = {};

  const required: Array<[keyof Pick<LeadEditorPatch, 'name' | 'address' | 'city' | 'state' | 'zip'>, string]> = [
    ['name', form.name],
    ['address', form.address],
    ['city', form.city],
    ['state', form.state],
    ['zip', form.zip],
  ];
  for (const [key, next] of required) {
    if (next !== text(lead[key])) patch[key] = next;
  }

  const optional: Array<[keyof Pick<LeadEditorPatch, 'phone' | 'email' | 'notes'>, string]> = [
    ['phone', form.phone],
    ['email', form.email],
    ['notes', form.notes],
  ];
  for (const [key, next] of optional) {
    const prev = text(lead[key]);
    if (next === prev) continue;
    patch[key] = next === '' ? null : next;
  }

  const nextBill = text(form.estimatedBill).trim();
  const prevBill = lead.estimatedBill == null ? '' : String(lead.estimatedBill);
  if (nextBill !== prevBill) {
    if (nextBill === '') {
      patch.estimatedBill = null;
    } else {
      const amount = Number(nextBill);
      if (Number.isFinite(amount)) patch.estimatedBill = amount;
    }
  }

  return patch;
}
