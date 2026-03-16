'use client';

import { useEffect } from 'react';
import type { SolarMadnessAwardResponse } from '@/app/types/solarMadness';

export default function SolarMadnessWinModal({ award, onClose }: { award: SolarMadnessAwardResponse & { matchup?: any }; onClose: () => void; }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const prizeLabel = award.prize
    ? award.prize.type === 'points'
      ? `+${award.pointsAwarded ?? 0} points`
      : award.prize.type === 'cash'
        ? `$${award.prize.cashValue ?? 0} cash + ${award.pointsAwarded ?? 0} pts`
        : `${award.prize.swagValue || award.prize.label} + ${award.pointsAwarded ?? 0} pts`
    : '';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-5 text-white">
          <div className="text-xs font-semibold tracking-widest opacity-90">SOLAR MADNESS</div>
          <div className="mt-1 text-2xl font-extrabold">YOU SCORED 🏀</div>
          {award.triggerType === 'appointment' && (
            <div className="mt-1 text-sm font-semibold">Big Basket — Appointment!</div>
          )}
        </div>

        <div className="px-6 py-5">
          <div className="text-center">
            <div className="text-4xl font-extrabold text-[#2D3748]">{prizeLabel}</div>
            {typeof award.oddsUsed === 'number' && (
              <div className="mt-2 text-sm text-[#718096]">Odds used: {Math.round(award.oddsUsed * 100)}%</div>
            )}
            {typeof award.totalPoints === 'number' && (
              <div className="mt-1 text-sm text-[#718096]">Total points: {award.totalPoints}</div>
            )}
            {award.matchup && (
              <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#F7FAFC] p-3 text-left">
                <div className="text-xs font-semibold text-[#2D3748]">Bracket matchup</div>
                <div className="mt-1 text-sm text-[#718096]">You: <span className="font-semibold text-[#2D3748]">{award.matchup.myPoints}</span> pts</div>
                <div className="text-sm text-[#718096]">Opponent: <span className="font-semibold text-[#2D3748]">{award.matchup.opponentPoints}</span> pts</div>
              </div>
            )}
          </div>

          <button
            className="mt-5 w-full h-12 rounded-xl bg-[#FF5F5A] text-white font-bold hover:bg-[#ff4a45] active:scale-[0.99] transition"
            onClick={onClose}
          >
            Keep Knocking →
          </button>
        </div>
      </div>
    </div>
  );
}
