/** Pin-critical fields only — keep map state small without new Firestore indexes. */
export function toThinMapLead(lead: Lead): Lead {
  return {
    id: lead.id,
    lat: lead.lat,
    lng: lead.lng,
    status: lead.status,
    name: lead.name,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    solarCategory: lead.solarCategory,
    solarScore: lead.solarScore,
    claimedBy: lead.claimedBy,
    assignedTo: lead.assignedTo,
    leadType: lead.leadType,
    source: lead.source,
    tags: lead.tags,
    disposition: lead.disposition,
    dispositionedAt: lead.dispositionedAt,
    dispositionHistory: lead.dispositionHistory,
    customerFirstName: (lead as any).customerFirstName,
    customerLastName: (lead as any).customerLastName,
    phone: lead.phone,
    createdAt: lead.createdAt,
  } as Lead;
}
