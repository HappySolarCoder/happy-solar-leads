'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, ToggleLeft, ToggleRight, Trophy, Zap } from 'lucide-react';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { canManageUsers } from '@/app/types';
import { EasterEgg } from '@/app/types/easterEgg';
import { getEasterEggsAsync, deleteEasterEggAsync, updateEasterEggAsync } from '@/app/utils/easterEggs';
import CreateEasterEggModal from '@/app/components/CreateEasterEggModal';

export default function EasterEggsAdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [eggs, setEggs] = useState<EasterEgg[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user || !canManageUsers(user.role)) {
        router.push('/');
        return;
      }
      setCurrentUser(user);

      const loadedEggs = await getEasterEggsAsync();
      setEggs(loadedEggs);
      setIsLoading(false);
    }
    loadData();
  }, [router]);

  const handleToggleActive = async (eggId: string, currentActive: boolean) => {
    await updateEasterEggAsync(eggId, { active: !currentActive });
    const updated = await getEasterEggsAsync();
    setEggs(updated);
  };

  const handleDelete = async (eggId: string) => {
    if (confirm('Delete this easter egg?')) {
      await deleteEasterEggAsync(eggId);
      const updated = await getEasterEggsAsync();
      setEggs(updated);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading easter eggs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/admin')}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-[#2D3748]">Easter Eggs</h1>
                <p className="text-sm text-[#718096]">Gamification & Motivation System</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#FF5F5A] to-[#F27141] text-white rounded-lg font-semibold hover:shadow-lg transition-shadow"
            >
              <Plus className="w-5 h-5" />
              Create Easter Egg
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-2xl p-6 text-white">
            <div className="text-3xl font-bold mb-1">{eggs.length}</div>
            <div className="text-white/80 text-sm">Total Eggs</div>
          </div>
          <div className="bg-gradient-to-br from-[#48BB78] to-[#38A169] rounded-2xl p-6 text-white">
            <div className="text-3xl font-bold mb-1">{eggs.filter(e => e.active).length}</div>
            <div className="text-white/80 text-sm">Active Now</div>
          </div>
          <div className="bg-gradient-to-br from-[#4299E1] to-[#3182CE] rounded-2xl p-6 text-white">
            <div className="text-3xl font-bold mb-1">{eggs.filter(e => e.type === 'odds').length}</div>
            <div className="text-white/80 text-sm">Odds-Based</div>
          </div>
          <div className="bg-gradient-to-br from-[#F6AD55] to-[#ED8936] rounded-2xl p-6 text-white">
            <div className="text-3xl font-bold mb-1">{eggs.filter(e => e.type === 'hidden').length}</div>
            <div className="text-white/80 text-sm">Hidden Pins</div>
          </div>
        </div>

        {/* Easter Eggs List */}
        <div className="space-y-4">
          {eggs.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-[#F7FAFC] rounded-full flex items-center justify-center mx-auto mb-4">
                <Trophy className="w-10 h-10 text-[#CBD5E0]" />
              </div>
              <h3 className="text-lg font-semibold text-[#2D3748] mb-2">No Easter Eggs Yet</h3>
              <p className="text-[#718096] mb-6">Create your first egg to start motivating your team!</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-[#FF5F5A] text-white rounded-lg font-semibold hover:bg-[#F27141] transition-colors"
              >
                Create First Egg
              </button>
            </div>
          ) : (
            eggs.map(egg => (
              <div
                key={egg.id}
                className="bg-white border border-[#E2E8F0] rounded-2xl p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between">
                  {/* Left: Egg Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        egg.type === 'odds' 
                          ? 'bg-gradient-to-br from-[#4299E1] to-[#3182CE]'
                          : 'bg-gradient-to-br from-[#F6AD55] to-[#ED8936]'
                      }`}>
                        {egg.type === 'odds' ? (
                          <Zap className="w-6 h-6 text-white" />
                        ) : (
                          <span className="text-2xl">🥚</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-[#2D3748]">{egg.prizeName}</h3>
                        <p className="text-sm text-[#718096]">{egg.prizeValue}</p>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        egg.active 
                          ? 'bg-[#C6F6D5] text-[#22543D]'
                          : 'bg-[#FED7D7] text-[#742A2A]'
                      }`}>
                        {egg.active ? 'Active' : 'Inactive'}
                      </div>
                    </div>

                    {/* Egg Details */}
                    <div className="space-y-2 text-sm">
                      {egg.type === 'odds' && (
                        <>
                          <p className="text-[#718096]">
                            <span className="font-semibold text-[#2D3748]">Odds:</span> 1 in {egg.odds || 50}
                          </p>
                          {egg.timeStart && (
                            <p className="text-[#718096]">
                              <span className="font-semibold text-[#2D3748]">Time:</span> After {egg.timeStart}
                            </p>
                          )}
                          <p className="text-[#718096]">
                            <span className="font-semibold text-[#2D3748]">Winners:</span> {egg.currentWinners || 0}
                            {egg.maxWinners ? ` / ${egg.maxWinners}` : ' (unlimited)'}
                          </p>
                        </>
                      )}
                      {egg.type === 'hidden' && (
                        <>
                          <p className="text-[#718096]">
                            <span className="font-semibold text-[#2D3748]">Status:</span> {
                              egg.wonBy && egg.wonBy.length > 0 ? '🏆 Found!' : '🔍 Hidden'
                            }
                          </p>
                          {egg.wonBy && egg.wonBy.length > 0 && (
                            <p className="text-[#718096]">
                              <span className="font-semibold text-[#2D3748]">Winner:</span> {egg.wonBy[0].userName}
                            </p>
                          )}
                        </>
                      )}
                      {egg.prizeDescription && (
                        <p className="text-[#718096] italic">{egg.prizeDescription}</p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(egg.id, egg.active)}
                      className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
                      title={egg.active ? 'Deactivate' : 'Activate'}
                    >
                      {egg.active ? (
                        <ToggleRight className="w-6 h-6 text-[#48BB78]" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-[#CBD5E0]" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(egg.id)}
                      className="p-2 hover:bg-[#FED7D7] rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-5 h-5 text-[#E53E3E]" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Create Modal */}
      {showCreateModal && currentUser && (
        <CreateEasterEggModal
          onClose={() => setShowCreateModal(false)}
          onCreated={async () => {
            const updated = await getEasterEggsAsync();
            setEggs(updated);
          }}
          currentUserId={currentUser.id}
        />
      )}
    </div>
  );
}
