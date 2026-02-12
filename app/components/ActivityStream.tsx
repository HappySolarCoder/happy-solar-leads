'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/app/utils/firebase';
import { getUsersAsync } from '@/app/utils/storage';
import { User } from '@/app/types';
import { formatDistanceToNow } from 'date-fns';

interface Activity {
  id: string;
  setterName: string;
  setterColor: string;
  address: string;
  disposition: string;
  dispositionEmoji: string;
  timestamp: Date;
}

export default function ActivityStream() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load users for name/color mapping
  useEffect(() => {
    getUsersAsync().then(setUsers);
  }, []);

  // Listen to today's disposition changes in real-time
  useEffect(() => {
    if (!db || users.length === 0) return;

    // Get start of today (midnight)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, 'leads'),
      where('dispositionedAt', '>=', Timestamp.fromDate(startOfToday)),
      orderBy('dispositionedAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const acts: Activity[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.disposition && data.claimedBy) {
          const setter = users.find(u => u.id === data.claimedBy);
          if (setter) {
            acts.push({
              id: doc.id,
              setterName: setter.name,
              setterColor: setter.color || '#FF5F5A',
              address: data.address || 'Unknown Address',
              disposition: data.disposition,
              dispositionEmoji: getDispositionEmoji(data.disposition),
              timestamp: data.dispositionedAt?.toDate() || new Date(),
            });
          }
        }
      });
      
      setActivities(acts);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [users]);

  // Get emoji for disposition (basic mapping)
  function getDispositionEmoji(disposition: string): string {
    const lower = disposition.toLowerCase();
    if (lower.includes('interested')) return '✅';
    if (lower.includes('not home')) return '🏠';
    if (lower.includes('not interested')) return '❌';
    if (lower.includes('callback')) return '📞';
    if (lower.includes('appointment')) return '📅';
    return '📋';
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#718096]">Loading activity...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#E2E8F0] bg-gradient-to-r from-[#F7FAFC] to-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-[#2D3748] text-lg">Activity Stream</h3>
              <p className="text-sm text-[#718096]">Live knock updates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-[#48BB78] rounded-full animate-pulse"></div>
            <span className="text-xs font-semibold text-[#48BB78]">LIVE</span>
          </div>
        </div>
      </div>

      {/* Activity List */}
      <div className="divide-y divide-[#E2E8F0] max-h-[500px] overflow-y-auto">
        {activities.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-[#F7FAFC] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#CBD5E0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <p className="font-semibold text-[#2D3748] mb-1">No activity yet</p>
            <p className="text-sm text-[#718096]">Knocks will appear here in real-time</p>
          </div>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="p-4 hover:bg-[#F7FAFC] transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* Setter Avatar */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-sm flex-shrink-0 shadow-sm"
                  style={{ backgroundColor: activity.setterColor }}
                >
                  {activity.setterName.charAt(0)}
                </div>

                {/* Activity Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-[#2D3748]">{activity.setterName}</span>
                    <span className="text-[#CBD5E0]">•</span>
                    <span className="text-xs text-[#718096]">
                      {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-[#718096] mb-1">{activity.address}</p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F7FAFC] rounded-lg">
                    <span className="text-base">{activity.dispositionEmoji}</span>
                    <span className="text-xs font-semibold text-[#2D3748]">{activity.disposition}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
