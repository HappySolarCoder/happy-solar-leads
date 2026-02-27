'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { EasterEggType } from '@/app/types/easterEgg';
import { createEasterEggAsync } from '@/app/utils/easterEggs';

interface Props {
  onClose: () => void;
  onCreated: () => void;
  currentUserId: string;
}

export default function CreateEasterEggModal({ onClose, onCreated, currentUserId }: Props) {
  const [type, setType] = useState<EasterEggType>('odds');
  const [prizeName, setPrizeName] = useState('');
  const [prizeValue, setPrizeValue] = useState('');
  const [prizeDescription, setPrizeDescription] = useState('');
  
  // Odds-based fields
  const [odds, setOdds] = useState('50');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [maxWinners, setMaxWinners] = useState('');
  
  // Hidden pin fields
  const [placement, setPlacement] = useState<'random' | 'manual'>('random');
  const [territoryFilter, setTerritoryFilter] = useState('');
  const [zipCode, setZipCode] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const eggData: any = {
        type,
        prizeName,
        prizeValue,
        active: true,
        createdBy: currentUserId
      };

      // Only add optional fields if they have values
      if (prizeDescription) eggData.prizeDescription = prizeDescription;

      if (type === 'odds') {
        eggData.odds = parseInt(odds);
        if (timeStart) eggData.timeStart = timeStart;
        if (timeEnd) eggData.timeEnd = timeEnd;
        if (maxWinners) eggData.maxWinners = parseInt(maxWinners);
      } else {
        eggData.placement = placement;
        if (territoryFilter) eggData.territoryFilter = territoryFilter;
        if (zipCode) eggData.zipCode = zipCode;
      }

      await createEasterEggAsync(eggData);
      onCreated();
      onClose();
    } catch (error) {
      console.error('Failed to create easter egg:', error);
      alert('Failed to create easter egg: ' + (error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-[#2D3748]">Create Easter Egg</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#718096]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Type Selection */}
          <div>
            <label className="block text-sm font-semibold text-[#2D3748] mb-3">
              Easter Egg Type
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setType('odds')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  type === 'odds'
                    ? 'border-[#FF5F5A] bg-[#FF5F5A]/5'
                    : 'border-[#E2E8F0] hover:border-[#CBD5E0]'
                }`}
              >
                <div className="text-3xl mb-2">⚡</div>
                <div className="font-bold text-[#2D3748]">Odds-Based</div>
                <div className="text-xs text-[#718096] mt-1">Multiple winners, chance-based</div>
              </button>
              <button
                type="button"
                onClick={() => setType('hidden')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  type === 'hidden'
                    ? 'border-[#FF5F5A] bg-[#FF5F5A]/5'
                    : 'border-[#E2E8F0] hover:border-[#CBD5E0]'
                }`}
              >
                <div className="text-3xl mb-2">🥚</div>
                <div className="font-bold text-[#2D3748]">Hidden Pin</div>
                <div className="text-xs text-[#718096] mt-1">One winner, treasure hunt</div>
              </button>
            </div>
          </div>

          {/* Prize Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Prize Name *
              </label>
              <input
                type="text"
                value={prizeName}
                onChange={(e) => setPrizeName(e.target.value)}
                placeholder="e.g., Late Night Bonus"
                required
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Prize Value *
              </label>
              <input
                type="text"
                value={prizeValue}
                onChange={(e) => setPrizeValue(e.target.value)}
                placeholder="e.g., $50 cash"
                required
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Description (optional)
              </label>
              <textarea
                value={prizeDescription}
                onChange={(e) => setPrizeDescription(e.target.value)}
                placeholder="Extra details about the prize..."
                rows={2}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              />
            </div>
          </div>

          {/* Type-specific fields */}
          {type === 'odds' ? (
            <div className="space-y-4 p-4 bg-[#F7FAFC] rounded-xl">
              <h3 className="font-bold text-[#2D3748]">Odds-Based Settings</h3>
              
              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  Odds (1 in N knocks) *
                </label>
                <input
                  type="number"
                  value={odds}
                  onChange={(e) => setOdds(e.target.value)}
                  placeholder="50"
                  required
                  min="1"
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
                <p className="text-xs text-[#718096] mt-1">
                  Chance: {odds ? `${(100 / parseInt(odds)).toFixed(2)}%` : '0%'} per knock
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                    Start Time (optional)
                  </label>
                  <input
                    type="time"
                    value={timeStart}
                    onChange={(e) => setTimeStart(e.target.value)}
                    className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                    End Time (optional)
                  </label>
                  <input
                    type="time"
                    value={timeEnd}
                    onChange={(e) => setTimeEnd(e.target.value)}
                    className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  Max Winners (optional)
                </label>
                <input
                  type="number"
                  value={maxWinners}
                  onChange={(e) => setMaxWinners(e.target.value)}
                  placeholder="Unlimited"
                  min="1"
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 p-4 bg-[#F7FAFC] rounded-xl">
              <h3 className="font-bold text-[#2D3748]">Hidden Pin Settings</h3>
              
              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  Placement
                </label>
                <select
                  value={placement}
                  onChange={(e) => setPlacement(e.target.value as 'random' | 'manual')}
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                >
                  <option value="random">Random (auto-select lead)</option>
                  <option value="manual">Manual (I'll choose later)</option>
                </select>
              </div>

              {placement === 'random' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                      Zip Code (optional)
                    </label>
                    <input
                      type="text"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      placeholder="e.g., 85001"
                      className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                    />
                    <p className="text-xs text-[#718096] mt-1">
                      Egg will be placed on a lead within 15 miles of this zip code
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                      Territory Filter (optional)
                    </label>
                    <input
                      type="text"
                      value={territoryFilter}
                      onChange={(e) => setTerritoryFilter(e.target.value)}
                      placeholder="e.g., Phoenix, Scottsdale"
                      className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                    />
                    <p className="text-xs text-[#718096] mt-1">
                      Additional filter - leave blank to use zip code only
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-[#F7FAFC] text-[#2D3748] rounded-lg font-semibold hover:bg-[#EDF2F7] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-[#FF5F5A] to-[#F27141] text-white rounded-lg font-semibold hover:shadow-lg transition-shadow disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Easter Egg'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
