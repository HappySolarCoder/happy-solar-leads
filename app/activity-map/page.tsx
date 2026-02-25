'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Calendar, Users, MapPin, Clock } from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User } from '@/app/types';
import { ensureUserColors } from '@/app/utils/userColors';

// Dynamic import for map (client-side only)
const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-xl">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-gray-500">Loading map...</p>
      </div>
    </div>
  ),
});

interface UserActivity {
  user: User;
  knocks: Lead[];
  startTime: Date;
  endTime: Date;
  totalKnocks: number;
}

export default function ActivityMapPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [userActivities, setUserActivities] = useState<UserActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        const user = await getCurrentAuthUser();
        
        if (!user) {
          router.push('/login');
          return;
        }

        // Only admins and managers can access
        if (user.role !== 'admin' && user.role !== 'manager') {
          router.push('/');
          return;
        }

        setCurrentUser(user);
        const loadedLeads = await getLeadsAsync();
        const loadedUsers = await getUsersAsync();

        setAllLeads(loadedLeads);
        setUsers(ensureUserColors(loadedUsers));
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading activity data:', error);
        setIsLoading(false);
      }
    }

    loadData();
  }, [router]);

  // Process activity data when date or user filter changes
  useEffect(() => {
    if (!selectedDate) return;

    // Parse selected date
    const dateStart = new Date(selectedDate);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(selectedDate);
    dateEnd.setHours(23, 59, 59, 999);

    // Filter leads knocked on selected date
    const knockedLeads = allLeads.filter(lead => {
      if (!lead.dispositionedAt) return false;
      
      const knockDate = new Date(lead.dispositionedAt);
      return knockDate >= dateStart && knockDate <= dateEnd;
    });

    // Group by user (using disposition history to find who knocked the door)
    const activitiesByUser = new Map<string, Lead[]>();
    
    knockedLeads.forEach(lead => {
      // Get the most recent disposition from history to find who knocked this door
      let userId: string | undefined;
      
      if (lead.dispositionHistory && lead.dispositionHistory.length > 0) {
        // Get the last disposition entry (most recent)
        const lastEntry = lead.dispositionHistory[lead.dispositionHistory.length - 1];
        userId = lastEntry.userId;
      } else {
        // Fallback to claimedBy if no disposition history
        userId = lead.claimedBy;
      }
      
      if (!userId) return;
      
      if (!activitiesByUser.has(userId)) {
        activitiesByUser.set(userId, []);
      }
      activitiesByUser.get(userId)!.push(lead);
    });

    // Build user activity objects
    const activities: UserActivity[] = [];
    
    activitiesByUser.forEach((knocks, userId) => {
      const user = users.find(u => u.id === userId);
      if (!user) return;

      // Sort knocks by time
      const sortedKnocks = knocks.sort((a, b) => {
        const timeA = a.dispositionedAt ? new Date(a.dispositionedAt).getTime() : 0;
        const timeB = b.dispositionedAt ? new Date(b.dispositionedAt).getTime() : 0;
        return timeA - timeB;
      });

      const firstDispositionedAt = sortedKnocks[0].dispositionedAt;
      const lastDispositionedAt = sortedKnocks[sortedKnocks.length - 1].dispositionedAt;
      
      const startTime = firstDispositionedAt 
        ? new Date(firstDispositionedAt)
        : new Date();
      
      const endTime = lastDispositionedAt
        ? new Date(lastDispositionedAt)
        : new Date();

      activities.push({
        user,
        knocks: sortedKnocks,
        startTime,
        endTime,
        totalKnocks: sortedKnocks.length,
      });
    });

    // Sort by total knocks (most active first)
    activities.sort((a, b) => b.totalKnocks - a.totalKnocks);

    setUserActivities(activities);
  }, [selectedDate, allLeads, users]);

  // Get filtered activities based on selected user
  const filteredActivities = selectedUserId === 'all' 
    ? userActivities 
    : userActivities.filter(a => a.user.id === selectedUserId);

  // Get all knocks for map display
  const allKnocks = filteredActivities.flatMap(a => a.knocks);

  // Build route waypoints for map
  const routeWaypoints = filteredActivities.flatMap(activity => 
    activity.knocks.map((knock, index) => ({
      lead: knock,
      order: index + 1,
      lat: knock.lat!,
      lng: knock.lng!,
    }))
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7FAFC]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading activity data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/admin')}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-[#2D3748]">Activity Map</h1>
                <p className="text-sm text-[#718096]">Track daily door knocking activity</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Date Picker */}
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#718096]" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              />
            </div>

            {/* User Filter */}
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#718096]" />
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="px-4 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              >
                <option value="all">All Users</option>
                {userActivities.map(activity => (
                  <option key={activity.user.id} value={activity.user.id}>
                    {activity.user.name} ({activity.totalKnocks} knocks)
                  </option>
                ))}
              </select>
            </div>

            {/* Summary Stats */}
            <div className="ml-auto flex items-center gap-6">
              <div className="text-sm">
                <span className="text-[#718096]">Total Knocks:</span>
                <span className="ml-2 font-semibold text-[#2D3748]">{allKnocks.length}</span>
              </div>
              <div className="text-sm">
                <span className="text-[#718096]">Active Users:</span>
                <span className="ml-2 font-semibold text-[#2D3748]">{filteredActivities.length}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* User Activity Cards */}
      {filteredActivities.length > 0 && (
        <div className="bg-white border-b border-[#E2E8F0] px-6 py-4">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredActivities.map(activity => (
                <div
                  key={activity.user.id}
                  className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg p-4"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
                      style={{ backgroundColor: activity.user.color }}
                    >
                      {activity.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[#2D3748] truncate">
                        {activity.user.name}
                      </div>
                      <div className="text-xs text-[#718096]">
                        {activity.user.role}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-[#718096]">
                      <MapPin className="w-4 h-4" />
                      <span className="font-semibold text-[#2D3748]">{activity.totalKnocks}</span>
                      <span>doors knocked</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#718096]">
                      <Clock className="w-4 h-4" />
                      <span>{activity.startTime.toLocaleTimeString()}</span>
                      <span>→</span>
                      <span>{activity.endTime.toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="flex-1 relative">
        {allKnocks.length > 0 ? (
          <LeadMap
            leads={allKnocks}
            currentUser={currentUser}
            users={users}
            onLeadClick={() => {}}
            routeWaypoints={routeWaypoints}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <MapPin className="w-16 h-16 text-[#CBD5E0] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-[#2D3748] mb-2">
                No Activity Found
              </h3>
              <p className="text-sm text-[#718096]">
                No doors were knocked on {new Date(selectedDate).toLocaleDateString()}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
