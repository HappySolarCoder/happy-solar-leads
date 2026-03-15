'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Target, Calendar, Clock } from 'lucide-react';
import { getMonthId, getMyGoalViaApiAsync, getMyMonthlyKnocksAsync, countWorkdaysElapsedAndRemaining, countWorkdaysInMonth } from '@/app/utils/goals';
import { User } from '@/app/types';

export default function GoalsPaceModal({
  currentUser,
  openOverride,
  onCloseOverride,
}: {
  currentUser: User;
  openOverride?: boolean;
  onCloseOverride?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [goal, setGoal] = useState<any>(null);
  const [knocks, setKnocks] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const monthId = useMemo(() => getMonthId(new Date()), []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const g = await getMyGoalViaApiAsync(monthId);
        if (!mounted) return;
        if (!g || !g.doorKnocksGoal) {
          setGoal(null);
          return;
        }
        setGoal({ doorKnocksGoal: g.doorKnocksGoal });
        const k = await getMyMonthlyKnocksAsync(new Date(), currentUser);
        if (!mounted) return;
        setKnocks(k);

        // Show once per day if goal exists
        const todayKey = new Date();
        const yyyy = todayKey.getFullYear();
        const mm = String(todayKey.getMonth() + 1).padStart(2, '0');
        const dd = String(todayKey.getDate()).padStart(2, '0');
        const lsKey = `raydar_goal_popup_seen_${currentUser.id}_${yyyy}-${mm}-${dd}`;
        const seen = typeof window !== 'undefined' ? localStorage.getItem(lsKey) : null;
        if (!seen) setIsOpen(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [currentUser, monthId]);

  const shouldShow = openOverride ?? isOpen;
  if (loading || !goal || !shouldShow) return null;

  const G = Number(goal.doorKnocksGoal || 0);
  const K = knocks;
  const { elapsed, remaining } = countWorkdaysElapsedAndRemaining(new Date());
  const totalWorkdays = countWorkdaysInMonth(new Date());
  const remainingWorkdays = Math.max(1, remaining);
  const needed = Math.max(0, G - K);
  const requiredPerDay = Math.ceil(needed / remainingWorkdays);

  const close = () => {
    const todayKey = new Date();
    const yyyy = todayKey.getFullYear();
    const mm = String(todayKey.getMonth() + 1).padStart(2, '0');
    const dd = String(todayKey.getDate()).padStart(2, '0');
    const lsKey = `raydar_goal_popup_seen_${currentUser.id}_${yyyy}-${mm}-${dd}`;
    try { localStorage.setItem(lsKey, '1'); } catch {}
    setIsOpen(false);
    onCloseOverride?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#E2E8F0] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-[#FF5F5A]" />
            <h3 className="text-lg font-semibold text-[#2D3748]">Today’s Target</h3>
          </div>
          <button onClick={close} className="h-10 w-10 rounded-full hover:bg-[#F7FAFC] flex items-center justify-center">
            <X className="w-5 h-5 text-[#718096]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4">
            <div className="text-sm text-[#718096]">Monthly goal</div>
            <div className="text-2xl font-bold text-[#2D3748]">{G} knocks</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="border border-[#E2E8F0] rounded-xl p-3">
              <div className="text-xs text-[#718096]">Completed so far</div>
              <div className="text-lg font-bold text-[#2D3748]">{K}</div>
            </div>
            <div className="border border-[#E2E8F0] rounded-xl p-3">
              <div className="text-xs text-[#718096]">Required / workday</div>
              <div className="text-lg font-bold text-[#FF5F5A]">{requiredPerDay}</div>
            </div>
          </div>

          <div className="text-sm text-[#4A5568] space-y-1">
            <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[#718096]" /> Workdays: {elapsed} elapsed • {remaining} remaining (of {totalWorkdays})</div>
            <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-[#718096]" /> Remaining knocks: {needed}</div>
          </div>

          <button
            onClick={close}
            className="w-full px-4 py-3 bg-[#FF5F5A] text-white rounded-xl font-semibold hover:bg-[#E54E49]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
