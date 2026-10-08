'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { auth } from '@/app/utils/firebase';

export default function AdminAptitudeDashboardPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [recommendationFilter, setRecommendationFilter] = useState('all');

  const load = async () => {
    const user = await getCurrentAuthUser();
    if (!user || !['admin', 'manager'].includes(user.role)) {
      router.push('/login');
      return;
    }
    const token = await auth?.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch('/api/admin/recruiting/aptitude-test', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    setSubmissions(json.submissions || []);
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => submissions.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (recommendationFilter !== 'all' && row.recommendation !== recommendationFilter) return false;
    return true;
  }), [submissions, statusFilter, recommendationFilter]);

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#2D3748]">Aptitude Test Dashboard</h1>
            <p className="text-[#718096]">Review recruiting submissions and identify high-upside candidates.</p>
          </div>
          <button onClick={() => router.push('/admin')} className="border border-[#E2E8F0] rounded-xl px-4 py-2">Back to Admin</button>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 flex flex-col md:flex-row gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-[#E2E8F0] rounded-xl">
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="reviewing">Reviewing</option>
            <option value="interview">Interview</option>
            <option value="rejected">Rejected</option>
            <option value="hired">Hired</option>
          </select>
          <select value={recommendationFilter} onChange={(e) => setRecommendationFilter(e.target.value)} className="px-3 py-2 border border-[#E2E8F0] rounded-xl">
            <option value="all">All recommendations</option>
            <option value="Strong Interview">Strong Interview</option>
            <option value="Interview">Interview</option>
            <option value="Maybe">Maybe</option>
            <option value="Low Priority">Low Priority</option>
          </select>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAFC] text-left text-[#718096]">
              <tr>
                <th className="p-4">Candidate</th>
                <th className="p-4">Submitted</th>
                <th className="p-4">Score</th>
                <th className="p-4">Recommendation</th>
                <th className="p-4">Status</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#E2E8F0]">
                  <td className="p-4">
                    <div className="font-semibold text-[#2D3748]">{row.candidate?.name}</div>
                    <div className="text-[#718096] text-xs">{row.candidate?.email}</div>
                  </td>
                  <td className="p-4">{row.submittedAt ? new Date(row.submittedAt).toLocaleString() : '—'}</td>
                  <td className="p-4 font-semibold">{row.totalScore}/100</td>
                  <td className="p-4">{row.recommendation}</td>
                  <td className="p-4 capitalize">{row.status || 'new'}</td>
                  <td className="p-4"><button onClick={() => router.push(`/admin/recruiting/aptitude-test/${row.id}`)} className="text-[#FF5F5A] font-semibold">Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
