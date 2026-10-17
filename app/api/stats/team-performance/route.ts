import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { buildTeamPerfLeadQuery, handleTeamPerformance } from '@/app/utils/server/teamPerformance';
import { getTeamPerfCache } from '@/app/utils/server/teamPerfCache';

export async function GET(request: NextRequest) {
  const result = await handleTeamPerformance({
    authorization: request.headers.get('authorization'),
    rangeParam: request.nextUrl.searchParams.get('range'),
    tzParam: request.nextUrl.searchParams.get('tz'),
    deps: {
      verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
      getUser: async (uid) => {
        const doc = await adminDb().collection('users').doc(uid).get();
        return { exists: doc.exists, data: doc.data() };
      },
      loadLeads: async (from, to) => {
        const snap = await buildTeamPerfLeadQuery(adminDb().collection('leads'), from, to).get();
        return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({
          id: doc.id,
          data: doc.data(),
        }));
      },
      loadUsers: async () => {
        const snap = await adminDb().collection('users').select('team', 'isTestAccount', 'testData').get();
        return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> | undefined }) => ({
          id: doc.id,
          data: doc.data() ?? {},
        }));
      },
      cache: getTeamPerfCache(),
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
