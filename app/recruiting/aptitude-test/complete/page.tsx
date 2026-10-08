'use client';

import { useRouter } from 'next/navigation';

export default function AptitudeTestCompletePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center px-4">
      <div className="max-w-xl w-full bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center">
        <p className="text-xs font-bold tracking-[0.3em] uppercase text-[#FF5F5A]">Submission received</p>
        <h1 className="text-3xl font-bold text-[#2D3748] mt-3">Thank you for completing the assessment</h1>
        <p className="text-[#718096] mt-4">Our team will review your results and reach out with next steps if there is a fit.</p>
        <button onClick={() => router.push('/')} className="mt-8 bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold py-3 px-6 rounded-xl">Done</button>
      </div>
    </div>
  );
}
