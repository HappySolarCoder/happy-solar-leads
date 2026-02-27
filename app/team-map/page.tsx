'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/app/utils/firebase';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { getLeadsAsync } from '@/app/utils/storage';
import Image from 'next/image';
import { startOfToday, startOfWeek, startOfMonth, isAfter, format } from 'date-fns';

const LeafletMap = dynamic(() => import('@/app/components/TeamMapView'), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-[#FF5F5A] to-[#F27141]">
      <div className="text-center">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
          <Image src="/raydar-icon.png" alt="" width={40} height={40} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <p className="text-white font-semibold mt-6 text-lg">Loading live map...</p>
      </div>
    </div>
  ),
});

type TimeFilter = 'today' | 'yesterday' | 'last7days' | 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'all';

interface TeamMember {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  lastUpdate: Date;
  status: string;
  doorsToday?: number;
  appointmentsToday?: number;
}

export default function TeamMapPage() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');

  useEffect(() => {
    getCurrentAuthUser().then(setCurrentUser);
  }, []);

  // Load leads for stats calculation
  useEffect(() => {
    async function loadLeads() {
      const loadedLeads = await getLeadsAsync();
      setLeads(loadedLeads);
    }
    loadLeads();
  }, []);

  // Calculate stats for each user based on time filter
  const getUserStats = (userId: string, filter: TimeFilter) => {
    // Get cutoff date based on filter
    let cutoffDate: Date;
    let endDate: Date | undefined;
    
    switch (filter) {
      case 'today':
        cutoffDate = startOfToday();
        break;
      case 'yesterday':
        cutoffDate = new Date(startOfToday().getTime() - 86400000);
        endDate = startOfToday();
        break;
      case 'last7days':
        cutoffDate = new Date(Date.now() - 7 * 86400000);
        break;
      case 'thisweek':
        cutoffDate = startOfWeek(new Date());
        break;
      case 'lastweek':
        cutoffDate = new Date(startOfWeek(new Date()).getTime() - 7 * 86400000);
        break;
      case 'thismonth':
        cutoffDate = startOfMonth(new Date());
        break;
      case 'lastmonth':
        cutoffDate = new Date(startOfMonth(new Date()).getTime() - 30 * 86400000);
        break;
      case 'all':
      default:
        cutoffDate = new Date(0);
        break;
    }
    
    // Get leads claimed by this user with disposition
    const userLeads = leads.filter(l => l.claimedBy === userId && l.dispositionedAt);
    
    // Filter to selected time period
    const filteredLeads = userLeads.filter(l => {
      const leadDate = new Date(l.dispositionedAt);
      if (!isAfter(leadDate, cutoffDate)) return false;
      if (endDate && !isAfter(endDate, leadDate)) return false;
      return true;
    });
    
    // Count doors (any disposition that counts as knock)
    const doorsKnocked = filteredLeads.filter(l => 
      ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(l.status)
    ).length;
    
    // Count appointments
    const appointments = filteredLeads.filter(l => 
      l.status === 'appointment' || l.status === 'sale'
    ).length;
    
    return { doors: doorsKnocked, appointments };
  };

  useEffect(() => {
    if (!currentUser || !db) return;

    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('isActive', '==', true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const members: TeamMember[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        
        if (data.currentLocation?.lat && data.currentLocation?.lng) {
          const lastUpdate = data.currentLocation.timestamp?.toDate() || new Date();
          const minutesAgo = (Date.now() - lastUpdate.getTime()) / 1000 / 60;
          
          if (minutesAgo < 30) {
            members.push({
              id: doc.id,
              name: data.name || 'Unknown',
              color: data.color || '#FF5F5A',
              lat: data.currentLocation.lat,
              lng: data.currentLocation.lng,
              lastUpdate: lastUpdate,
              status: data.status || 'In Field',
              doorsToday: 0, // Will be calculated from leads
              appointmentsToday: 0 // Will be calculated from leads
            });
          }
        }
      });
      
      setTeamMembers(members);
    });

    return () => unsubscribe();
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-[#FF5F5A] to-[#F27141]">
        <p className="text-white font-semibold">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black overflow-hidden">
      {/* Native iOS-style header */}
      <div className="relative z-50">
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-transparent backdrop-blur-xl"></div>
        <div className="relative px-5 pt-safe pb-4">
          <div className="flex items-center justify-between mb-4">
            <a 
              href="/"
              className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </a>
            
            <div className="flex-1 flex justify-center">
              <Image src="/raydar-horizontal.png" alt="Raydar" width={120} height={32} className="h-8 w-auto" />
            </div>
            
            <button className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <h1 className="text-white text-2xl font-bold tracking-tight">Live Tracking</h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 bg-[#48BB78] rounded-full animate-pulse"></div>
                <p className="text-white/70 text-sm font-medium">{teamMembers.length} in field now</p>
              </div>
            </div>
            
            {/* Time Filter */}
            <div className="flex items-center bg-white/10 backdrop-blur-md rounded-lg p-1">
              {[
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'last7days', label: '7d' },
                { key: 'all', label: 'All' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTimeFilter(f.key as TimeFilter)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    timeFilter === f.key
                      ? 'bg-white text-[#2D3748]'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Full-bleed map */}
      <div className="flex-1 relative -mt-20">
        <LeafletMap teamMembers={teamMembers} onMemberClick={setSelectedMember} />
      </div>

      {/* Premium bottom sheet */}
      {showBottomSheet && (
        <div 
          className="absolute bottom-0 left-0 right-0 bg-white shadow-2xl transition-transform duration-300 ease-out"
          style={{
            borderTopLeftRadius: '32px',
            borderTopRightRadius: '32px',
            maxHeight: '45vh',
            transform: selectedMember ? 'translateY(0)' : 'translateY(0)'
          }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1.5 bg-[#E2E8F0] rounded-full"></div>
          </div>

          <div className="px-6 pb-safe overflow-y-auto" style={{ maxHeight: 'calc(45vh - 32px)' }}>
            {selectedMember ? (
              /* Selected member detail */
              <div className="py-4">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-white text-2xl shadow-lg"
                      style={{ 
                        backgroundColor: selectedMember.color,
                        boxShadow: `0 8px 32px ${selectedMember.color}40`
                      }}
                    >
                      {selectedMember.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-[#2D3748] text-xl">{selectedMember.name}</h3>
                      <p className="text-[#718096] text-sm mt-0.5">{selectedMember.status}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedMember(null)}
                    className="w-8 h-8 rounded-full bg-[#F7FAFC] flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <svg className="w-4 h-4 text-[#718096]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Stats cards */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-2xl p-4 text-white">
                    <div className="text-3xl font-bold">{getUserStats(selectedMember.id, timeFilter).doors}</div>
                    <div className="text-white/80 text-sm mt-1">Doors {timeFilter === 'today' ? 'Today' : timeFilter === 'yesterday' ? 'Yesterday' : ''}</div>
                  </div>
                  <div className="bg-gradient-to-br from-[#48BB78] to-[#38A169] rounded-2xl p-4 text-white">
                    <div className="text-3xl font-bold">{getUserStats(selectedMember.id, timeFilter).appointments}</div>
                    <div className="text-white/80 text-sm mt-1">Appointments</div>
                  </div>
                </div>

                <div className="text-xs text-[#A0AEC0] text-center">
                  Updated {Math.round((Date.now() - selectedMember.lastUpdate.getTime()) / 1000 / 60)} min ago
                </div>
              </div>
            ) : (
              /* Team list */
              <>
                <h3 className="font-bold text-[#2D3748] text-lg mb-4 pt-2">Active Team</h3>
                
                {teamMembers.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-[#F7FAFC] rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-[#CBD5E0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-[#718096] font-medium">No one's in the field right now</p>
                  </div>
                ) : (
                  <div className="space-y-2 pb-4">
                    {teamMembers.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => setSelectedMember(member)}
                        className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#F7FAFC] hover:bg-[#EDF2F7] active:scale-98 transition-all"
                      >
                        <div
                          className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-md flex-shrink-0"
                          style={{ backgroundColor: member.color }}
                        >
                          {member.name.charAt(0)}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="font-semibold text-[#2D3748] text-base">{member.name}</div>
                          <div className="text-sm text-[#718096] mt-0.5">{getUserStats(member.id, timeFilter).doors} doors • {getUserStats(member.id, timeFilter).appointments} appts</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 bg-[#48BB78] rounded-full animate-pulse"></div>
                          <svg className="w-5 h-5 text-[#CBD5E0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
