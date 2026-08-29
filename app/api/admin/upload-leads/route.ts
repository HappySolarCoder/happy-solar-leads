import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

function normalizeAddressKey(street: string, city: string, state: string, zip?: string) {
  const norm = (s: string) => String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\.,]/g, '')
    .replace(/\s+#\s*/g, '#');
  return `${norm(street)}|${norm(city)}|${norm(state)}|${norm(zip || '')}`;
}

async function assertAdmin(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing credentials'), { status: 401 });
  }
  const idToken = authHeader.split(' ')[1];
  const decoded = await adminAuth().verifyIdToken(idToken);
  const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
  const userData = userDoc.data();
  if (!userDoc.exists || userData?.role !== 'admin') {
    throw Object.assign(new Error('Not authorized'), { status: 403 });
  }
  return { decoded };
}

export async function POST(request: NextRequest) {
  try {
    await assertAdmin(request);

    const body = await request.json();
    const leadType = body?.leadType as 'prospect' | 'customer';
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const geocodes = Array.isArray(body?.geocodes) ? body.geocodes : [];

    if (!leadType || (leadType !== 'prospect' && leadType !== 'customer')) {
      return NextResponse.json({ error: 'Invalid leadType' }, { status: 400 });
    }

    // Build lookup by normalized addressKey for existing leads (single read)
    const leadsSnap = await adminDb().collection('leads').get();
    const existingByKey = new Map<string, any>();
    leadsSnap.forEach((doc) => {
      const data = doc.data();
      const key = normalizeAddressKey(data.address, data.city, data.state, data.zip);
      existingByKey.set(key, { id: doc.id, ...data });
    });

    let saved = 0;
    let updated = 0;
    let skipped = 0;
    const errors: any[] = [];

    const batchSize = 400;
    let batch = adminDb().batch();
    let batchCount = 0;

    const commitBatch = async () => {
      if (batchCount === 0) return;
      await batch.commit();
      batch = adminDb().batch();
      batchCount = 0;
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const g = geocodes[i] || {};
      const address = String(r.address || r.street || '').trim();
      const city = String(r.city || '').trim();
      const state = String(r.state || '').trim();
      const zip = String(r.zip || '').trim();

      if (!address || !city || !state) {
        skipped++;
        continue;
      }

      const key = normalizeAddressKey(address, city, state, zip);
      const existing = existingByKey.get(key);

      const leadId = existing?.id || (leadType === 'customer'
        ? `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

      const ref = adminDb().collection('leads').doc(leadId);

      if (leadType === 'customer') {
        const fullName = String(r.name || `${r.firstName || ''} ${r.lastName || ''}`.trim()).trim();
        const [firstName, ...rest] = fullName.split(' ');
        const lastName = rest.join(' ').trim();

        const soldDateRaw = r.soldDate || r['sold date'] || '';
        let soldDate: Date | undefined;
        if (soldDateRaw) {
          const dt = new Date(soldDateRaw);
          if (!isNaN(dt.getTime())) soldDate = dt;
        }

        const docData: any = {
          leadType: 'customer',
          name: fullName,
          customerFirstName: firstName || undefined,
          customerLastName: lastName || undefined,
          soldByName: r.salesRep || r.soldByName || r['sales rep'] || undefined,
          setByName: r.fma || r.setByName || r['fma'] || undefined,
          soldDate: soldDate || undefined,
          phone: r.phone || undefined,
          address,
          city,
          state,
          zip,
          lat: Number(g.lat) || existing?.lat,
          lng: Number(g.lng) || existing?.lng,
          status: 'customer',
          updatedAt: new Date(),
          createdAt: existing?.createdAt || new Date(),

          // Clear prospect-only fields to ensure override
          solarCategory: null,
          shading: null,
          disposition: null,
          dispositionedAt: null,
          goBackScheduledDate: null,
          goBackScheduledTime: null,
          goBackNotes: null,
        };

        batch.set(ref, docData, { merge: true });
      } else {
        // Prospect: keep existing behavior minimal (server-side write only)
        const fullName = String(r.name || '').trim();
        const docData: any = {
          leadType: existing?.leadType || 'prospect',
          name: fullName,
          phone: r.phone || undefined,
          email: r.email || undefined,
          address,
          city,
          state,
          zip,
          lat: Number(g.lat) || existing?.lat,
          lng: Number(g.lng) || existing?.lng,
          updatedAt: new Date(),
          createdAt: existing?.createdAt || new Date(),
        };

        batch.set(ref, docData, { merge: true });
      }

      if (existing) updated++;
      else saved++;

      batchCount++;
      if (batchCount >= batchSize) {
        await commitBatch();
      }
    }

    await commitBatch();

    return NextResponse.json({ success: true, saved, updated, skipped, errors });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('[Upload Leads] error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status });
  }
}
