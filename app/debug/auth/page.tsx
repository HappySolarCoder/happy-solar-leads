'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/app/utils/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query } from 'firebase/firestore';

export default function AuthDebugPage() {
  const [debug, setDebug] = useState<'0' | '1'>('0');

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [claims, setClaims] = useState<any>(null);

  const [userDocStatus, setUserDocStatus] = useState<any>(null);
  const [leadsReadStatus, setLeadsReadStatus] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setDebug(sp.get('debug') === '1' ? '1' : '0');
    } catch {
      setDebug('0');
    }
  }, []);

  useEffect(() => {
    if (debug !== '1') return;

    if (!auth) {
      setError('Firebase auth not initialized');
      return;
    }
    if (!db) {
      setError('Firebase firestore not initialized');
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        setError(null);

        if (!u) {
          setFirebaseUid(null);
          setEmail(null);
          setClaims(null);
          setUserDocStatus({ ok: false, error: 'No authenticated user' });
          setLeadsReadStatus(null);
          return;
        }

        setFirebaseUid(u.uid);
        setEmail(u.email ?? null);

        const token = await u.getIdTokenResult();
        setClaims(token?.claims ?? null);

        const firestore = db!;

        // Can we read users/{uid}?
        try {
          const snap = await getDoc(doc(firestore, 'users', u.uid));
          setUserDocStatus({ ok: true, exists: snap.exists(), dataKeys: snap.exists() ? Object.keys(snap.data() || {}) : [] });
        } catch (e: any) {
          setUserDocStatus({ ok: false, error: e?.message || String(e), code: e?.code });
        }

        // Can we read leads at all?
        try {
          const q = query(collection(firestore, 'leads'), limit(1));
          const snap = await getDocs(q);
          setLeadsReadStatus({ ok: true, count: snap.size });
        } catch (e: any) {
          setLeadsReadStatus({ ok: false, error: e?.message || String(e), code: e?.code });
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    });

    return () => unsub();
  }, [debug]);

  if (debug !== '1') {
    return (
      <div className="p-6">
        <div className="text-lg font-semibold">Auth Debug</div>
        <div className="text-sm text-gray-600 mt-2">Add <code>?debug=1</code> to use this page.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-6">
      <div className="max-w-3xl mx-auto bg-white border border-[#E2E8F0] rounded-2xl p-6">
        <div className="text-xl font-bold text-[#2D3748]">Auth Debug</div>
        <div className="text-sm text-[#718096] mt-1">Use this to diagnose login → bounce issues (permissions, missing user doc, etc.).</div>

        {error ? (
          <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800">{error}</div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 text-sm">
          <div className="bg-[#F7FAFC] rounded-xl p-3">
            <div className="text-xs text-[#718096]">Firebase UID</div>
            <div className="font-mono break-all">{firebaseUid ?? '—'}</div>
          </div>
          <div className="bg-[#F7FAFC] rounded-xl p-3">
            <div className="text-xs text-[#718096]">Email</div>
            <div className="font-mono break-all">{email ?? '—'}</div>
          </div>
          <div className="bg-[#F7FAFC] rounded-xl p-3">
            <div className="text-xs text-[#718096]">Token claims</div>
            <pre className="text-xs overflow-auto">{JSON.stringify(claims, null, 2)}</pre>
          </div>

          <div className="bg-[#F7FAFC] rounded-xl p-3">
            <div className="text-xs text-[#718096]">Read users/{'{uid}'}</div>
            <pre className="text-xs overflow-auto">{JSON.stringify(userDocStatus, null, 2)}</pre>
          </div>

          <div className="bg-[#F7FAFC] rounded-xl p-3">
            <div className="text-xs text-[#718096]">Read leads (limit 1)</div>
            <pre className="text-xs overflow-auto">{JSON.stringify(leadsReadStatus, null, 2)}</pre>
          </div>
        </div>

        <div className="mt-4 text-xs text-[#718096]">
          If <code>Read users</code> or <code>Read leads</code> shows a permission error (e.g. <code>permission-denied</code>), this is a Firestore Rules/role provisioning issue.
        </div>
      </div>
    </div>
  );
}
