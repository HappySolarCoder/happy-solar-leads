// Minimal GoHighLevel (LeadConnector v2) client for the Empower bump.
// One request per call, no retries: an ambiguous failure surfaces to the
// route as a GhlRequestError and becomes a 502 without a receipt.
// Never log the token, request bodies, or GHL responses.

import { EMPOWER_GHL_LOCATION_ID, EMPOWER_PIPELINE_ID } from './empowerBumpContract';

export const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
export const GHL_API_VERSION = '2021-07-28';
const GHL_TIMEOUT_MS = 15_000;

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect?: 'error';
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class GhlRequestError extends Error {
  status: number;
  operation: string;

  constructor(operation: string, status: number) {
    // Status and operation name only. No URL, no body, no GHL text.
    super(`GHL ${operation} failed (${status || 'network'})`);
    this.name = 'GhlRequestError';
    this.status = status;
    this.operation = operation;
  }
}

export type GhlCustomFieldValue = string | number | string[];
export type GhlCustomFieldWrite = { id: string; fieldValue: GhlCustomFieldValue };

export type GhlContact = {
  id: string;
  phone?: string;
  email?: string;
  customFields: Array<{ id: string; value: unknown }>;
};

export type GhlOpportunity = {
  id: string;
  pipelineId: string;
  status: string;
  updatedAt: number;
  customFields: Array<{ id: string; value: unknown }>;
};

export type GhlContactWrite = {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  customFields?: GhlCustomFieldWrite[];
};

export type EmpowerGhlClient = {
  findContactByPhone: (e164: string) => Promise<GhlContact | null>;
  findContactByEmail: (email: string) => Promise<GhlContact | null>;
  getContact: (contactId: string) => Promise<GhlContact | null>;
  createContact: (body: GhlContactWrite) => Promise<string>;
  updateContact: (contactId: string, body: GhlContactWrite) => Promise<void>;
  addContactNote: (contactId: string, body: string) => Promise<void>;
  addContactTags: (contactId: string, tags: string[]) => Promise<void>;
  listEmpowerOpportunities: (contactId: string) => Promise<GhlOpportunity[]>;
  createOpportunity: (body: {
    name: string;
    contactId: string;
    pipelineStageId: string;
    customFields: GhlCustomFieldWrite[];
  }) => Promise<string>;
  updateOpportunity: (opportunityId: string, body: { customFields: GhlCustomFieldWrite[] }) => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function readCustomFields(raw: unknown): Array<{ id: string; value: unknown }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; value: unknown }> = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const id = str(rec.id);
    if (!id) continue;
    const value = rec.value ?? rec.fieldValue ?? rec.fieldValueString ?? rec.fieldValueArray ?? rec.fieldValueNumber ?? null;
    out.push({ id, value });
  }
  return out;
}

function toContact(raw: unknown): GhlContact | null {
  const rec = asRecord(raw);
  const id = str(rec.id);
  if (!id) return null;
  return {
    id,
    phone: str(rec.phone) || undefined,
    email: str(rec.email) || undefined,
    customFields: readCustomFields(rec.customFields),
  };
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(str(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOpportunity(raw: unknown): GhlOpportunity | null {
  const rec = asRecord(raw);
  const id = str(rec.id);
  if (!id) return null;
  return {
    id,
    pipelineId: str(rec.pipelineId),
    status: str(rec.status).toLowerCase(),
    updatedAt: toMillis(rec.updatedAt ?? rec.lastStatusChangeAt ?? rec.createdAt),
    customFields: readCustomFields(rec.customFields),
  };
}

export function createGhlClient(input: {
  token: string;
  fetch: FetchLike;
  locationId?: string;
}): EmpowerGhlClient {
  const locationId = input.locationId ?? EMPOWER_GHL_LOCATION_ID;

  async function call(operation: string, method: string, path: string, options: {
    query?: Record<string, string>;
    body?: unknown;
    allow404?: boolean;
  } = {}): Promise<Record<string, unknown> | null> {
    const url = new URL(GHL_BASE_URL + path);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${input.token}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await input.fetch(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'error',
        signal: AbortSignal.timeout(GHL_TIMEOUT_MS),
      });
    } catch {
      throw new GhlRequestError(operation, 0);
    }
    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) throw new GhlRequestError(operation, response.status);
    let text = '';
    try {
      text = await response.text();
    } catch {
      throw new GhlRequestError(operation, response.status);
    }
    if (!text) return {};
    try {
      return asRecord(JSON.parse(text));
    } catch {
      throw new GhlRequestError(operation, response.status);
    }
  }

  async function findDuplicate(operation: string, query: Record<string, string>): Promise<GhlContact | null> {
    const payload = await call(operation, 'GET', '/contacts/search/duplicate', {
      query: { locationId, ...query },
      allow404: true,
    });
    if (!payload) return null;
    return toContact(payload.contact);
  }

  function requireId(operation: string, value: unknown): string {
    const id = str(value);
    if (!id) throw new GhlRequestError(operation, 200);
    return id;
  }

  return {
    findContactByPhone: (e164) => findDuplicate('contact phone lookup', { number: e164 }),
    findContactByEmail: (email) => findDuplicate('contact email lookup', { email }),
    async getContact(contactId) {
      const payload = await call('contact read', 'GET', `/contacts/${encodeURIComponent(contactId)}`, { allow404: true });
      return payload ? toContact(payload.contact) : null;
    },
    async createContact(body) {
      const payload = await call('contact create', 'POST', '/contacts/', { body: { ...body, locationId } });
      return requireId('contact create', asRecord(payload?.contact).id);
    },
    async updateContact(contactId, body) {
      await call('contact update', 'PUT', `/contacts/${encodeURIComponent(contactId)}`, { body });
    },
    async addContactNote(contactId, body) {
      await call('contact note', 'POST', `/contacts/${encodeURIComponent(contactId)}/notes`, { body: { body } });
    },
    async addContactTags(contactId, tags) {
      await call('contact tag', 'POST', `/contacts/${encodeURIComponent(contactId)}/tags`, { body: { tags } });
    },
    async listEmpowerOpportunities(contactId) {
      const payload = await call('opportunity search', 'GET', '/opportunities/search', {
        query: {
          location_id: locationId,
          contact_id: contactId,
          pipeline_id: EMPOWER_PIPELINE_ID,
          status: 'all',
          limit: '20',
        },
      });
      // An unexpected shape is ambiguous, not "none found": treating it as
      // empty would create a second Empower+ opportunity.
      if (!payload || !Array.isArray(payload.opportunities)) throw new GhlRequestError('opportunity search', 200);
      return payload.opportunities
        .map(toOpportunity)
        .filter((opp): opp is GhlOpportunity => (
          Boolean(opp) && (opp!.pipelineId === EMPOWER_PIPELINE_ID || opp!.pipelineId === '')
        ));
    },
    async createOpportunity(body) {
      const payload = await call('opportunity create', 'POST', '/opportunities/', {
        body: {
          locationId,
          pipelineId: EMPOWER_PIPELINE_ID,
          pipelineStageId: body.pipelineStageId,
          name: body.name,
          status: 'open',
          contactId: body.contactId,
          customFields: body.customFields,
        },
      });
      return requireId('opportunity create', asRecord(payload?.opportunity).id);
    },
    async updateOpportunity(opportunityId, body) {
      await call('opportunity update', 'PUT', `/opportunities/${encodeURIComponent(opportunityId)}`, { body });
    },
  };
}
