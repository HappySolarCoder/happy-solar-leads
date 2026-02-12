'use client';

import { useEffect, useState } from 'react';
import { EasterEgg } from '@/app/types/easterEgg';
import confetti from 'canvas-confetti';

interface Props {
  egg: EasterEgg;
  onClose: () => void;
}

export default function EasterEggWinModal({ egg, onClose }: Props) {
  const [hasTriggeredConfetti, setHasTriggeredConfetti] = useState(false);

  useEffect(() => {
    if (!hasTriggeredConfetti) {
      // Trigger confetti animation
      const duration = 3000;
      const end = Date.now() + duration;

      const interval = setInterval(() => {
        if (Date.now() > end) {
          clearInterval(interval);
          return;
        }

        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#FF5F5A', '#F27141', '#FFD700', '#FFA500']
        });
      }, 250);

      setHasTriggeredConfetti(true);

      // Play sound (if available)
      try {
        const audio = new Audio('/celebration.mp3');
        audio.play().catch(() => {
          // Ignore if sound fails
        });
      } catch (e) {
        // Ignore sound errors
      }
    }
  }, [hasTriggeredConfetti]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden animate-bounce-in">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-[#FF5F5A] to-[#F27141] p-8 text-center">
          <div className="text-6xl mb-4 animate-pulse">
            {egg.type === 'odds' ? '🎰' : '🥚'}
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">
            {egg.type === 'odds' ? 'LUCKY KNOCK!' : 'JACKPOT!'}
          </h2>
          {egg.type === 'hidden' && (
            <p className="text-white/90 text-sm">You found the Golden Door!</p>
          )}
        </div>

        {/* Content */}
        <div className="p-8 text-center">
          <p className="text-[#718096] mb-4">
            {egg.type === 'odds' ? 'You just won:' : 'You discovered:'}
          </p>
          
          <div className="mb-6">
            <div className="text-4xl font-bold text-[#2D3748] mb-2">
              {egg.prizeName}
            </div>
            <div className="text-2xl font-semibold text-[#FF5F5A]">
              {egg.prizeValue}
            </div>
            {egg.prizeDescription && (
              <p className="text-sm text-[#718096] mt-2">{egg.prizeDescription}</p>
            )}
          </div>

          {egg.type === 'odds' && egg.odds && (
            <p className="text-sm text-[#718096] mb-6">
              You beat the 1 in {egg.odds} odds! 🎉<br />
              Keep knocking for more prizes!
            </p>
          )}

          {egg.type === 'hidden' && (
            <p className="text-sm text-[#718096] mb-6">
              This was hidden somewhere on the map.<br />
              <span className="font-semibold text-[#2D3748]">You're the FIRST to find it!</span> 🏆
            </p>
          )}

          <div className="space-y-3">
            <button
              onClick={onClose}
              className="w-full px-6 py-4 bg-gradient-to-r from-[#FF5F5A] to-[#F27141] text-white rounded-xl font-bold text-lg hover:shadow-xl transition-all transform hover:scale-105"
            >
              🎉 Awesome!
            </button>
            
            <button
              onClick={() => {
                // TODO: Implement share functionality
                alert('Share feature coming soon!');
              }}
              className="w-full px-6 py-3 bg-[#F7FAFC] text-[#2D3748] rounded-xl font-semibold hover:bg-[#EDF2F7] transition-colors"
            >
              📢 Brag to Team
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
