# Hot leads contract

Contract v2, 2026-11-04.

Repo copy of the 3PL / hot-lead API contract. Code identifiers stay `hotLead*`. The product label is 3PL. This file amends C3 and C4 for the server territory gate.

## C1. Who can see a 3PL pin

Variant A (shipped): closers, managers, admins. Setters are denied on `GET /api/hot-leads`, `POST /api/field/dispo` when `collection` is `hotLeads`, and `POST /api/hot-leads/claim`.

The only role switch is `HOT_LEAD_ROLE_VARIANT` in `app/utils/server/hotLeadContract.ts`. Viewing is not territory-gated. A variant A role can open a 3PL pin anywhere.

## C2. What a write may change

Knock, disposition, notes, claim, and release write only their allowlisted fields. They do not write `ghl`, contacts, coordinates, geo, import metadata, or link ids. A stored field-dispo receipt replays its stored response and does not write again.

Regular `leads` and `homeowners` saves keep their existing rules. On a merged house, only the 3PL action is territory-gated.

## C3. Read shape

`GET /api/hot-leads?mode=map` returns `{ hotLeads, nextCursor, capabilities }`.

`capabilities` is `{ dispo: true, claim: true, territoryGate: true }`. `territoryGate: true` means this server applies the C4 gate.

Each map pin, and `hotLead` from `mode=one` (`GET /api/hot-leads?id=`), includes:

- `canDispo: boolean`
- `dispoBlock: null | 'outside_territory' | 'no_territory' | 'territory_unknown' | 'no_coords'`

Staff (manager, admin) are always `canDispo: true` and `dispoBlock: null`. For everyone else, those two fields are the same decision the write routes would make. The map loads the caller's territories once per request. `GET` never returns 403 because of territory.

## C4. Territory gate

The server is the only authority. The test is the pin's lat/lng on the `hotLeads` document, not the rep's GPS. It applies to every 3PL write: knock, disposition, notes, claim, and release. Managers and admins bypass it. Everyone else:

1. Load `territories` where `userId == uid`, limit 200.
2. If that read is truncated (200 or more docs): `dispoBlock` `territory_unknown`.
3. If the caller has no counted polygon (archived and polygons with fewer than 3 points are skipped): `dispoBlock` `no_territory`.
4. If the pin lat/lng is missing or not finite: `dispoBlock` `no_coords`.
5. If `insideTerritory` contains the point in one of those polygons: allow. No extra edge tolerance.
6. Otherwise: `dispoBlock` `outside_territory`.

Every territory refusal is HTTP 403 with exactly these fields:

`{ ok: false, error: 'forbidden', reasonCode: 'out_of_territory', dispoBlock }`

`reasonCode` is the existing `out_of_territory` code from `FIELD_REASON_CODES`. The client treats only that value as terminal. `outside_territory`, `no_territory`, `territory_unknown`, and `no_coords` are the `dispoBlock` value. They are never the `reasonCode`.

The gate runs after the receipt replay check and before any write. Replaying a stored receipt returns that stored response even if the territory changed later. A denied write stores nothing, so a later attempt is not a replay.

`firestore.rules` does not grant client access to `hotLeads`. A closer cannot read another user's `territories` document directly.
