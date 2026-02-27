'use client';

import { useState, useEffect } from 'react';
import { X, Trophy, Gift, Users, Clock } from 'lucide-react';
import { EasterEgg } from '@/app/types/easterEgg';
import { getActiveEasterEggsAsync } from '@/app/utils/easterEggs';

interface Props {
  onClose: () => void;
}

export default function EasterEggInfoModal({ onClose }: Props) {
  const [eggs, setEggs] = useState<EasterEgg[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadEggs() {
      const activeEggs = await getActiveEasterEggsAsync();
      setEggs(activeEggs);
      setIsLoading(false);
    }
    loadEggs();
  }, []);

  // Get current hour in EST
  const getEstHour = () => {
    const now = new Date();
    // Convert to EST (UTC-5)
    const estOffset = -5;
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const estDate = new Date(utc + (3600000 * estOffset));
    return estDate.getHours();
  };

  const estHour = getEstHour();
  const isAfter6AM = estHour >= 6;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#FF5F5A] to-[#F27141] px-6 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-4xl">🥚</div>
              <div>
                <h2 className="text-xl font-bold text-white">Easter Eggs Available!</h2>
                <p className="text-white/80 text-sm">Win prizes by knocking doors today</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {!isAfter6AM ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 text-yellow-800">
                <Clock className="w-5 h-5" />
                <span className="font-semibold">Check back at 6 AM EST!</span>
              </div>
              <p className="text-yellow-700 text-sm mt-1">
                New easter eggs will be available starting at 6 AM EST.
              </p>
            </div>
          ) : null}

          {isLoading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-[#718096] mt-2">Loading easter eggs...</p>
            </div>
          ) : eggs.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">😢</div>
              <p className="text-[#718096]">No easter eggs available right now.</p>
              <p className="text-[#A0AEC0] text-sm mt-1">Check back later!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {eggs.map((egg) => (
                <div
                  key={egg.id}
                  className="border border-[#E2E8F0] rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-bold text-[#2D3748]">{egg.prizeName}</h3>
                      <p className="text-[#FF5F5A] font-semibold">{egg.prizeValue}</p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      egg.type === 'odds' 
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {egg.type === 'odds' ? '🎲 Odds-based' : '🔍 Hidden Pin'}
                    </div>
                  </div>

                  {egg.type === 'odds' && (
                    <div className="space-y-2 text-sm">
                      {egg.timeStart && egg.timeEnd && (
                        <p className="text-[#718096]">
                          <Clock className="w-4 h-4 inline mr-1" />
                          Knock between {egg.timeStart} - {egg.timeEnd}
                        </p>
                      )}
                      <p className="text-[#718096]">
                        <Trophy className="w-4 h-4 inline mr-1" />
                        Odds: 1 in {egg.odds || 50}
                      </p>
                    </div>
                  )}

                  {egg.type === 'hidden' && (
                    <p className="text-sm text-purple-600 font-medium">
                      🎯 Randomly placed - find it while knocking!
                    </p>
                  )}

                  <div className="mt-3 pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-[#718096]">
                      <Users className="w-4 h-4" />
                      <span>{egg.currentWinners || 0} winners</span>
                    </div>
                    {egg.maxWinners && (
                      <div className="text-[#718096]">
                        {egg.maxWinners - (egg.currentWinners || 0)} remaining
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full mt-6 py-3 bg-[#FF5F5A] text-white rounded-xl font-semibold hover:bg-[#F27141] transition-colors"
          >
            Let's Go Knock! 🚪
          </button>
        </div>
      </div>
    </div>
  );
}
