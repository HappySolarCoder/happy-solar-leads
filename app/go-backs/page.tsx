'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, List, MapPin, Clock, FileText, User as UserIcon, ArrowLeft, Settings, X, Route, Map, Filter, Users, BarChart3, Layers } from 'lucide-react';
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
  const [viewMode, setViewMode] = useState<'upcoming' | 'calendar' | 'list'>('calendar');
  const [isMobile, setIsMobile] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedDayLeads, setSelectedDayLeads] = useState<Lead[]>([]);
  const [showDaySheet, setShowDaySheet] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showTools, setShowTools] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      // Mobile default: Upcoming agenda
      setViewMode((prev) => (mobile && prev === 'calendar' ? 'upcoming' : prev));
    };
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

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

  const sortByScheduled = (a: Lead, b: Lead) => {
    const dateA = a.goBackScheduledDate ? new Date(a.goBackScheduledDate).getTime() : 0;
    const dateB = b.goBackScheduledDate ? new Date(b.goBackScheduledDate).getTime() : 0;
    if (dateA !== dateB) return dateA - dateB;
    const tA = a.goBackScheduledTime || '';
    const tB = b.goBackScheduledTime || '';
    return tA.localeCompare(tB);
  };

  const getDateLabel = (d: Date) => {
    if (isSameDay(d, new Date())) return 'Today';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (isSameDay(d, tomorrow)) return 'Tomorrow';
    return format(d, 'EEE, MMM d');
  };

  const groupedUpcoming = (): Array<{ date: Date; leads: Lead[] }> => {
    const map = new globalThis.Map<string, { date: Date; leads: Lead[] }>();
    for (const lead of [...leads].sort(sortByScheduled)) {
      if (!lead.goBackScheduledDate) continue;
      const d = new Date(lead.goBackScheduledDate);
      const key = format(d, 'yyyy-MM-dd');
      const entry = map.get(key) || { date: d, leads: [] as Lead[] };
      entry.leads.push(lead);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
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
    <div className="min-h-screen bg-[#F7FAFC] overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10 overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => router.push('/mobile/knocking')}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
              <h1 className="text-xl sm:text-2xl font-bold text-[#2D3748] truncate">Go Backs</h1>
              <span className="px-2.5 py-1 bg-[#FF5F5A] text-white text-xs sm:text-sm rounded-full font-medium flex-shrink-0">
                {leads.length}
              </span>
            </div>

            {/* View Toggle & Tools */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
              <button
                onClick={() => setShowTools(true)}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
                title="Tools"
              >
                <Settings className="w-5 h-5 text-[#718096]" />
              </button>

              {/* Desktop: Calendar/List. Mobile: Upcoming/Calendar */}
              <div className="flex items-center gap-1 sm:gap-2 bg-[#F7FAFC] p-1 rounded-lg w-full sm:w-auto">
                {isMobile ? (
                  <>
                    <button
                      onClick={() => setViewMode('upcoming')}
                      className={`flex-1 px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-2 ${
                        viewMode === 'upcoming'
                          ? 'bg-white text-[#FF5F5A] shadow-sm'
                          : 'text-[#718096] hover:text-[#2D3748]'
                      }`}
                    >
                      <List className="w-4 h-4" />
                      <span>Upcoming</span>
                    </button>
                    <button
                      onClick={() => setViewMode('calendar')}
                      className={`flex-1 px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-2 ${
                        viewMode === 'calendar'
                          ? 'bg-white text-[#FF5F5A] shadow-sm'
                          : 'text-[#718096] hover:text-[#2D3748]'
                      }`}
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Calendar</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setViewMode('calendar')}
                      className={`px-2 sm:px-4 py-2 rounded-md transition-colors flex items-center gap-1 sm:gap-2 ${
                        viewMode === 'calendar'
                          ? 'bg-white text-[#FF5F5A] shadow-sm'
                          : 'text-[#718096] hover:text-[#2D3748]'
                      }`}
                    >
                      <Calendar className="w-4 h-4" />
                      <span className="hidden sm:inline">Calendar</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`px-2 sm:px-4 py-2 rounded-md transition-colors flex items-center gap-1 sm:gap-2 ${
                        viewMode === 'list'
                          ? 'bg-white text-[#FF5F5A] shadow-sm'
                          : 'text-[#718096] hover:text-[#2D3748]'
                      }`}
                    >
                      <List className="w-4 h-4" />
                      <span className="hidden sm:inline">List</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto px-3 py-4 sm:max-w-7xl sm:px-6 sm:py-8 lg:px-8">
        {leads.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Calendar className="w-16 h-16 text-[#CBD5E0] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#2D3748] mb-2">No Go Backs Scheduled</h3>
            <p className="text-[#718096]">
              When you mark leads as "Go Back" and schedule a date, they'll appear here.
            </p>
          </div>
        ) : viewMode === 'upcoming' ? (
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-[#E2E8F0]">
              <h2 className="text-lg font-semibold text-[#2D3748]">Upcoming</h2>
              <p className="text-sm text-[#718096]">Mobile-first agenda view</p>
            </div>

            <div className="divide-y divide-[#E2E8F0]">
              {groupedUpcoming().map(({ date, leads: dayLeads }) => (
                <div key={format(date, 'yyyy-MM-dd')} className="p-4">
                  <div className="text-xs font-semibold text-[#718096] mb-3">{getDateLabel(date)}</div>
                  <div className="space-y-3">
                    {dayLeads.map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => { setSelectedLeadId(lead.id); setShowLeadDetail(true); }}
                        className="w-full text-left border border-[#E2E8F0] rounded-xl p-3 hover:bg-[#F7FAFC] active:scale-[0.99] transition-all"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#2D3748] truncate">{lead.name || 'Unknown'}</div>
                            <div className="mt-0.5 text-xs text-[#718096] truncate">{lead.address}</div>
                          </div>
                          <div className="flex-shrink-0">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#F7FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#2D3748]">
                              <Clock className="w-3.5 h-3.5 text-[#718096]" />
                              {lead.goBackScheduledTime || 'Anytime'}
                            </span>
                          </div>
                        </div>
                        {lead.goBackNotes && (
                          <div className="mt-2 text-xs text-[#4A5568] line-clamp-1">{lead.goBackNotes}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
                    className={`min-h-[${isMobile ? '64px' : '100px'}] border rounded-lg p-2 ${
                      !isCurrentMonth ? 'bg-[#F7FAFC] opacity-50' : 'bg-white'
                    } ${dayIsToday ? 'border-[#FF5F5A] border-2' : 'border-[#E2E8F0]'}`}
                  >
                    <div className={`text-sm font-medium mb-1 ${
                      dayIsToday ? 'text-[#FF5F5A]' : dayIsPast ? 'text-[#CBD5E0]' : 'text-[#2D3748]'
                    }`}>
                      {format(day, 'd')}
                    </div>
                    {isMobile ? (
                      <button
                        onClick={() => {
                          setSelectedDate(day);
                          setSelectedDayLeads(dayLeads.sort(sortByScheduled));
                          setShowDaySheet(true);
                        }}
                        className="mt-2 w-full flex items-center justify-center"
                      >
                        {dayLeads.length > 0 ? (
                          <div className="flex items-center gap-1">
                            {Array.from({ length: Math.min(dayLeads.length, 3) }).map((_, i) => (
                              <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#FF5F5A]" />
                            ))}
                            {dayLeads.length > 3 && (
                              <span className="ml-1 text-[10px] font-semibold text-[#FF5F5A]">+{dayLeads.length - 3}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-transparent">.</span>
                        )}
                      </button>
                    ) : (
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
                    )}
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
                            <span className="line-clamp-1">{lead.goBackNotes}</span>
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

      {/* Mobile Day Sheet (Calendar → day details) */}
      {showDaySheet && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowDaySheet(false)} />
          <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto">
            <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[#2D3748]">{getDateLabel(selectedDate)}</div>
                <div className="text-xs text-[#718096]">{selectedDayLeads.length} go back{selectedDayLeads.length === 1 ? '' : 's'}</div>
              </div>
              <button
                onClick={() => setShowDaySheet(false)}
                className="h-10 w-10 rounded-full hover:bg-[#F7FAFC] flex items-center justify-center"
                title="Close"
              >
                <X className="w-5 h-5 text-[#718096]" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {selectedDayLeads.length === 0 ? (
                <div className="text-sm text-[#718096]">No go backs scheduled.</div>
              ) : (
                selectedDayLeads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => { setSelectedLeadId(lead.id); setShowLeadDetail(true); setShowDaySheet(false); }}
                    className="w-full text-left border border-[#E2E8F0] rounded-xl p-3 hover:bg-[#F7FAFC] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#2D3748] truncate">{lead.name || 'Unknown'}</div>
                        <div className="mt-0.5 text-xs text-[#718096] truncate">{lead.address}</div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#F7FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#2D3748] flex-shrink-0">
                        <Clock className="w-3.5 h-3.5 text-[#718096]" />
                        {lead.goBackScheduledTime || 'Anytime'}
                      </span>
                    </div>
                    {lead.goBackNotes && (
                      <div className="mt-2 text-xs text-[#4A5568] line-clamp-1">{lead.goBackNotes}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Tools Slide-out Panel */}
      {showTools && (
        <div>
          <div 
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowTools(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-80 bg-white shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[#E2E8F0]">
              <h2 className="text-lg font-semibold text-[#2D3748] flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Tools
              </h2>
              <button
                onClick={() => setShowTools(false)}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#718096]" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <button
                onClick={() => { setShowTools(false); router.push('/tools?tab=route'); }}
                className="w-full flex items-center gap-3 p-3 bg-[#F7FAFC] hover:bg-[#EDF2F7] rounded-lg transition-colors text-left"
              >
                <Route className="w-5 h-5 text-[#FF5F5A]" />
                <div>
                  <div className="text-sm font-medium text-[#2D3748]">Route All</div>
                  <div className="text-xs text-[#718096]">Optimize route for all go-backs</div>
                </div>
              </button>
              <button
                onClick={() => { setShowTools(false); router.push('/tools?tab=optimize'); }}
                className="w-full flex items-center gap-3 p-3 bg-[#F7FAFC] hover:bg-[#EDF2F7] rounded-lg transition-colors text-left"
              >
                <Map className="w-5 h-5 text-[#48BB78]" />
                <div>
                  <div className="text-sm font-medium text-[#2D3748]">Generate Optimized Route</div>
                  <div className="text-xs text-[#718096]">AI-powered route optimization</div>
                </div>
              </button>
              <button
                onClick={() => { setShowTools(false); router.push('/territories'); }}
                className="w-full flex items-center gap-3 p-3 bg-[#F7FAFC] hover:bg-[#EDF2F7] rounded-lg transition-colors text-left"
              >
                <Filter className="w-5 h-5 text-[#4299E1]" />
                <div>
                  <div className="text-sm font-medium text-[#2D3748]">Filter by Territory</div>
                  <div className="text-xs text-[#718096]">View go-backs by territory</div>
                </div>
              </button>
              <button
                onClick={() => { setShowTools(false); router.push('/team-map'); }}
                className="w-full flex items-center gap-3 p-3 bg-[#F7FAFC] hover:bg-[#EDF2F7] rounded-lg transition-colors text-left"
              >
                <Users className="w-5 h-5 text-[#9F7AEA]" />
                <div>
                  <div className="text-sm font-medium text-[#2D3748]">Team Activity</div>
                  <div className="text-xs text-[#718096]">View team performance</div>
                </div>
              </button>
              <button
                onClick={() => { setShowTools(false); router.push('/setter-stats'); }}
                className="w-full flex items-center gap-3 p-3 bg-[#F7FAFC] hover:bg-[#EDF2F7] rounded-lg transition-colors text-left"
              >
                <BarChart3 className="w-5 h-5 text-[#ED8936]" />
                <div>
                  <div className="text-sm font-medium text-[#2D3748]">Setter Stats</div>
                  <div className="text-xs text-[#718096]">Setter performance metrics</div>
                </div>
              </button>
              <button
                onClick={() => { setShowTools(false); router.push('/lead-management'); }}
                className="w-full flex items-center gap-3 p-3 bg-[#F7FAFC] hover:bg-[#EDF2F7] rounded-lg transition-colors text-left"
              >
                <Layers className="w-5 h-5 text-[#38B2AC]" />
                <div>
                  <div className="text-sm font-medium text-[#2D3748]">Lead Management</div>
                  <div className="text-xs text-[#718096]">Manage all leads</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
