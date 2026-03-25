'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { auth } from '@/app/utils/firebase';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { aptitudeQuestions, sectionLabels } from '@/app/utils/aptitudeTest';

export default function AptitudeSubmissionDetailPage() {
  const params = useParams<{ submissionId: string }>();
  const router = useRouter();
  const [submission, setSubmission] = useState<any>(null);
  const [status, setStatus] = useState('new');
  const [notes, setNotes] = useState('');

  const load = async () => {
    const user = await getCurrentAuthUser();
    if (!user || !['admin', 'manager'].includes(user.role)) {
      router.push('/login');
      return;
    }
    const token = await auth?.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`/api/admin/recruiting/aptitude-test/${params.submissionId}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    setSubmission(json.submission);
    setStatus(json.submission?.status || 'new');
    setNotes(json.submission?.notes || '');
  };

  useEffect(() => { if (params?.submissionId) load(); }, [params?.submissionId]);

  const save = async () => {
    const token = await auth?.currentUser?.getIdToken();
    if (!token) return;
    await fetch(`/api/admin/recruiting/aptitude-test/${params.submissionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, notes }),
    });
    await load();
  };

  if (!submission) return <div className="min-h-screen flex items-center justify-center">Loading submission...</div>;

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <button onClick={() => router.push('/admin/recruiting/aptitude-test')} className="border border-[#E2E8F0] rounded-xl px-4 py-2">Back</button>
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[#2D3748]">{submission.candidate?.name}</h1>
              <p className="text-[#718096] mt-1">{submission.candidate?.email} • {submission.candidate?.phone} • {submission.candidate?.city}, {submission.candidate?.state}</p>
              <p className="text-sm text-[#718096] mt-2">Submitted {submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : '—'}</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-[#718096]">Total Score</div>
              <div className="text-4xl font-bold text-[#FF5F5A]">{submission.totalScore}</div>
              <div className="mt-2 inline-flex px-3 py-1 rounded-full bg-[#FFF5F5] text-[#C53030] font-semibold">{submission.recommendation}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6">
            <h2 className="text-lg font-bold mb-4">Section Scores</h2>
            <div className="space-y-4">
              {Object.entries(submission.sectionScores || {}).map(([key, value]) => (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1"><span>{sectionLabels[key as keyof typeof sectionLabels]}</span><span>{String(value)}</span></div>
                  <div className="h-2 rounded-full bg-[#EDF2F7]"><div className="h-full rounded-full bg-[#FF5F5A]" style={{ width: `${Math.min(Number(value), 30) / (key === 'grit' ? 30 : 20) * 100}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 text-sm">
              <div><div className="font-semibold text-green-700 mb-2">Green Flags</div><ul className="list-disc list-inside text-[#4A5568] space-y-1">{(submission.greenFlags || []).map((flag: string) => <li key={flag}>{flag}</li>)}</ul></div>
              <div><div className="font-semibold text-red-700 mb-2">Red Flags</div><ul className="list-disc list-inside text-[#4A5568] space-y-1">{(submission.redFlags || []).map((flag: string) => <li key={flag}>{flag}</li>)}</ul></div>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold">Review Actions</h2>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-3 border border-[#E2E8F0] rounded-xl">
              <option value="new">New</option>
              <option value="reviewing">Reviewing</option>
              <option value="interview">Interview</option>
              <option value="rejected">Rejected</option>
              <option value="hired">Hired</option>
            </select>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add recruiter notes..." className="w-full min-h-[180px] px-3 py-3 border border-[#E2E8F0] rounded-xl" />
            <button onClick={save} className="w-full bg-[#FF5F5A] text-white font-semibold py-3 rounded-xl">Save Review</button>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-4">Answer Review</h2>
          <div className="space-y-4">
            {aptitudeQuestions.map((question) => {
              const answerValue = submission.answers?.[question.id];
              const answerLabel = question.options?.find((opt) => opt.value === answerValue)?.label || answerValue || '—';
              return (
                <div key={question.id} className="border border-[#E2E8F0] rounded-xl p-4">
                  <div className="text-xs text-[#FF5F5A] font-semibold uppercase tracking-[0.25em] mb-2">{question.id}</div>
                  <div className="font-semibold text-[#2D3748]">{question.prompt}</div>
                  <div className="mt-2 text-[#4A5568]">Answer: <span className="font-semibold">{answerLabel}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
