import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { buildStatsLeadQuery, handleAllLeadsStats, isExcludedTestLead } from '@/app/utils/server/allLeadsStats';

export async function GET(request: NextRequest) {
  const started = Date.now();
  let role = 'unknown';
  let docsRead = 0;
  const sinceParam = request.nextUrl.searchParams.get('since');
  const sinceLog = sinceParam?.trim() ? sinceParam.trim() : '-';
  try {
    const result = await handleAllLeadsStats({
      authorization: request.headers.get('authorization'),
      sinceParam,
      deps: {
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        getUser: async (uid) => {
          const doc = await adminDb().collection('users').doc(uid).get();
          const data = doc.data();
          if (typeof data?.role === 'string' && data.role.trim()) role = data.role.trim();
          return { exists: doc.exists, data };
        },
        loadLeads: async (bound) => {
          const snap = await buildStatsLeadQuery(adminDb().collection('leads'), bound).get();
          docsRead = snap.docs.length;
          return snap.docs
            .map((doc: { id: string; data: () => Record<string, unknown> }) => ({
              id: doc.id,
              data: doc.data(),
            }))
            .filter((doc: { id: string; data: Record<string, unknown> }) => !isExcludedTestLead(doc.id, doc.data));
        },
      },
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[stats/all-leads] error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    console.log(`[stats/all-leads] ${role} ${sinceLog} ${docsRead} ${Date.now() - started}`);
  }
}
