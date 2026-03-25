'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { aptitudeQuestions, likertOptions, scoreAptitudeTest, sectionLabels } from '@/app/utils/aptitudeTest';

const totalSteps = 2 + aptitudeQuestions.length;

export default function AptitudeTestPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [candidate, setCandidate] = useState({ name: '', email: '', phone: '', city: '', state: '', isAdult: false, referredBy: '' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const progress = Math.round(((step + 1) / totalSteps) * 100);
  const currentQuestion = aptitudeQuestions[step - 2];

  const currentSectionLabel = useMemo(() => {
    if (!currentQuestion) return 'Candidate Information';
    return sectionLabels[currentQuestion.section];
  }, [currentQuestion]);

  const handleNext = async () => {
    if (step === 1) {
      if (!candidate.name || !candidate.email || !candidate.phone || !candidate.city || !candidate.state || !candidate.isAdult) return;
    }
    if (currentQuestion && !answers[currentQuestion.id]) return;

    if (step === totalSteps - 1) {
      setIsSubmitting(true);
      try {
        const scoring = scoreAptitudeTest(answers);
        const response = await fetch('/api/admin/recruiting/aptitude-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidate,
            answers,
            ...scoring,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        router.push('/recruiting/aptitude-test/complete');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setStep((s) => s + 1);
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] text-[#2D3748]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold text-[#FF5F5A]">Field Marketing Agent Aptitude Test</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden border border-[#E2E8F0]">
            <div className="h-full bg-[#FF5F5A] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {step === 0 && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 space-y-5">
            <p className="text-xs font-bold tracking-[0.3em] text-[#FF5F5A] uppercase">Built for competitors</p>
            <h1 className="text-3xl font-bold">Field Marketing Agent Aptitude Test</h1>
            <p className="text-[#718096] leading-relaxed">This 8–12 minute assessment helps us identify candidates with grit, coachability, competitiveness, judgment, and upside for door-to-door solar appointment setting.</p>
            <div className="bg-[#FFF8F5] border border-[#FED7AA] rounded-xl p-4 text-sm space-y-1">
              <p>• Takes about 10 minutes</p>
              <p>• One question at a time</p>
              <p>• No perfect answers — answer honestly</p>
              <p>• Used to identify high-upside field talent</p>
            </div>
            <button onClick={() => setStep(1)} className="w-full bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold py-3 rounded-xl">Start Assessment</button>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 space-y-4">
            <h2 className="text-2xl font-bold">Tell us about yourself</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ['name', 'Full name'],
                ['email', 'Email'],
                ['phone', 'Phone'],
                ['city', 'City'],
                ['state', 'State'],
                ['referredBy', 'Referred by (optional)'],
              ].map(([key, label]) => (
                <input key={key} value={(candidate as any)[key]} onChange={(e) => setCandidate({ ...candidate, [key]: e.target.value })} placeholder={label} className="w-full px-4 py-3 border border-[#E2E8F0] rounded-xl" />
              ))}
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={candidate.isAdult} onChange={(e) => setCandidate({ ...candidate, isAdult: e.target.checked })} />
              I confirm I am at least 18 years old
            </label>
            <div className="flex gap-3">
              <button onClick={() => setStep(0)} className="flex-1 border border-[#E2E8F0] rounded-xl py-3">Back</button>
              <button onClick={handleNext} className="flex-1 bg-[#FF5F5A] text-white rounded-xl py-3 font-semibold">Continue</button>
            </div>
          </div>
        )}

        {currentQuestion && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#FF5F5A]">{currentSectionLabel}</p>
              <h2 className="text-2xl font-bold mt-2">{currentQuestion.prompt}</h2>
            </div>

            <div className="space-y-3">
              {(currentQuestion.options || []).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option.value }))}
                  className={`w-full text-left p-4 border-2 rounded-xl transition ${answers[currentQuestion.id] === option.value ? 'border-[#FF5F5A] bg-[#FFF5F5]' : 'border-[#E2E8F0] hover:border-[#FF5F5A]/40'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep((s) => Math.max(0, s - 1))} className="flex-1 border border-[#E2E8F0] rounded-xl py-3">Back</button>
              <button onClick={handleNext} disabled={!answers[currentQuestion.id] || isSubmitting} className="flex-1 bg-[#FF5F5A] text-white rounded-xl py-3 font-semibold disabled:opacity-60">{step === totalSteps - 1 ? (isSubmitting ? 'Submitting...' : 'Submit Assessment') : 'Next'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
