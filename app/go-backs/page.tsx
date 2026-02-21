'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, List, MapPin, Clock, FileText, User as UserIcon, ArrowLeft } from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads } from '@/app/types';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, isPast, isFuture, startOfWeek, endOfWeek } from 'date-fns';
import LeadDetail from '@/app/components/LeadDetail';

export default function GoBacksPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      const loadedLeads = await getLeadsAsync();
      const loadedUsers = await getUsersAsync();
      
      // Filter for go-back leads only
      const goBackLeads = loadedLeads.filter(lead => {
        // Show go backs that have a scheduled date
        if (lead.status !== 'go-back' || !lead.goBackScheduledDate) {
          return false;
        }
        
        // If user can see all leads, show all go backs
        if (canSeeAllLeads(user.role)) {
          return true;
        }
        
        // Otherwise, only show user's own go backs
        return lead.claimedBy === user.id || lead.goBackScheduledBy === user.id;
      });

      setLeads(goBackLeads);
      setUsers(loadedUsers);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  const handleUpdate = async () => {
    const loadedLeads = await getLeadsAsync();
    const goBackLeads = loadedLeads.filter(lead => {
      if (lead.status !== 'go-back' || !lead.goBackScheduledDate) {
        return false;
      }
      if (currentUser && canSeeAllLeads(currentUser.role)) {
        return true;
      }
      return lead.claimedBy === currentUser?.id || lead.goBackScheduledBy === currentUser?.id;
    });
    setLeads(goBackLeads);
  };

  const getUserById = (id: string) => users.find(u => u.id === id);

  // Calendar view helpers
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getLeadsForDate = (date: Date) => {
    return leads.filter(lead => 
      lead.goBackScheduledDate && isSameDay(new Date(lead.goBackScheduledDate), date)
    );
  };

  const nextMonth = () => {
    setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading go backs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/mobile/knocking')}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
              <h1 className="text-2xl font-bold text-[#2D3748]">Go Backs</h1>
              <span className="px-3 py-1 bg-[#FF5F5A] text-white text-sm rounded-full font-medium">
                {leads.length}
              </span>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 bg-[#F7FAFC] p-1 rounded-lg">
              <button
                onClick={() => setViewMode('calendar')}
                className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                  viewMode === 'calendar'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                <Calendar className="w-4 h-4" />
                Calendar
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                  viewMode === 'list'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                <List className="w-4 h-4" />
                List
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {leads.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Calendar className="w-16 h-16 text-[#CBD5E0] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#2D3748] mb-2">No Go Backs Scheduled</h3>
            <p className="text-[#718096]">
              When you mark leads as "Go Back" and schedule a date, they'll appear here.
            </p>
          </div>
        ) : viewMode === 'calendar' ? (
          <div className="bg-white rounded-lg shadow-sm p-6">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={prevMonth}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
              <h2 className="text-xl font-semibold text-[#2D3748]">
                {format(selectedDate, 'MMMM yyyy')}
              </h2>
              <button
                onClick={nextMonth}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors rotate-180"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-center text-sm font-medium text-[#718096] py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day, index) => {
                const dayLeads = getLeadsForDate(day);
                const isCurrentMonth = day.getMonth() === selectedDate.getMonth();
                const dayIsToday = isToday(day);
                const dayIsPast = isPast(day) && !dayIsToday;

                return (
                  <div
                    key={index}
                    className={`min-h-[100px] border rounded-lg p-2 ${
                      !isCurrentMonth ? 'bg-[#F7FAFC] opacity-50' : 'bg-white'
                    } ${dayIsToday ? 'border-[#FF5F5A] border-2' : 'border-[#E2E8F0]'}`}
                  >
                    <div className={`text-sm font-medium mb-1 ${
                      dayIsToday ? 'text-[#FF5F5A]' : dayIsPast ? 'text-[#CBD5E0]' : 'text-[#2D3748]'
                    }`}>
                      {format(day, 'd')}
                    </div>
                    <div className="space-y-1">
                      {dayLeads.map((lead) => (
                        <button
                          key={lead.id}
                          onClick={() => {
                            setSelectedLeadId(lead.id);
                            setShowLeadDetail(true);
                          }}
                          className="w-full text-left px-2 py-1 bg-[#FEF5E7] hover:bg-[#FDE7C5] rounded text-xs text-[#2D3748] truncate transition-colors"
                        >
                          {lead.goBackScheduledTime && (
                            <span className="font-medium">{lead.goBackScheduledTime} </span>
                          )}
                          {lead.address.split(',')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm divide-y divide-[#E2E8F0]">
            {leads
              .sort((a, b) => {
                const dateA = a.goBackScheduledDate ? new Date(a.goBackScheduledDate).getTime() : 0;
                const dateB = b.goBackScheduledDate ? new Date(b.goBackScheduledDate).getTime() : 0;
                return dateA - dateB;
              })
              .map((lead) => {
                const scheduledDate = lead.goBackScheduledDate ? new Date(lead.goBackScheduledDate) : null;
                const user = lead.goBackScheduledBy ? getUserById(lead.goBackScheduledBy) : null;
                const dateIsPast = scheduledDate && isPast(scheduledDate) && !isToday(scheduledDate);

                return (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelectedLeadId(lead.id);
                      setShowLeadDetail(true);
                    }}
                    className="w-full p-4 hover:bg-[#F7FAFC] transition-colors text-left"
                  >
                    <div className="flex items-start gap-4">
                      {/* Date Badge */}
                      <div className={`flex-shrink-0 w-16 text-center p-2 rounded-lg ${
                        dateIsPast ? 'bg-[#FED7D7]' : 'bg-[#FEF5E7]'
                      }`}>
                        <div className={`text-2xl font-bold ${
                          dateIsPast ? 'text-[#C53030]' : 'text-[#FF5F5A]'
                        }`}>
                          {scheduledDate ? format(scheduledDate, 'd') : '?'}
                        </div>
                        <div className="text-xs text-[#718096]">
                          {scheduledDate ? format(scheduledDate, 'MMM') : ''}
                        </div>
                      </div>

                      {/* Lead Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="w-4 h-4 text-[#718096] flex-shrink-0" />
                          <span className="font-medium text-[#2D3748] truncate">{lead.address}</span>
                        </div>
                        {lead.goBackScheduledTime && (
                          <div className="flex items-center gap-2 mb-1 text-sm text-[#718096]">
                            <Clock className="w-3 h-3" />
                            {lead.goBackScheduledTime}
                          </div>
                        )}
                        {lead.goBackNotes && (
                          <div className="flex items-start gap-2 text-sm text-[#718096]">
                            <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{lead.goBackNotes}</span>
                          </div>
                        )}
                        {user && (
                          <div className="flex items-center gap-2 mt-2 text-xs text-[#718096]">
                            <UserIcon className="w-3 h-3" />
                            Scheduled by {user.name}
                          </div>
                        )}
                      </div>

                      {/* Past Due Badge */}
                      {dateIsPast && (
                        <div className="flex-shrink-0">
                          <span className="px-2 py-1 bg-[#FED7D7] text-[#C53030] text-xs rounded-full font-medium">
                            Past Due
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* Lead Detail Sidebar */}
      {showLeadDetail && selectedLeadId && currentUser && (
        <LeadDetail
          lead={leads.find(l => l.id === selectedLeadId)!}
          currentUser={currentUser}
          onClose={() => {
            setShowLeadDetail(false);
            setSelectedLeadId(undefined);
          }}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
