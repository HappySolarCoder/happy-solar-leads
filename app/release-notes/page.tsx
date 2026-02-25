'use client';

import { useState } from 'react';
import { ArrowLeft, Calendar, BarChart3, Users, Zap, TrendingUp, MapPin, Navigation, Shield, Clock, ChevronDown, ChevronRight, Sparkles, Bug } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ReleaseNote {
  id: string;
  date: string;
  title: string;
  description: string;
  icon: any;
  screenshot?: string;
  howTo: string[];
  category: 'new' | 'improvement' | 'fix';
  permissions?: 'all' | 'setters' | 'managers' | 'admins';
}

const releaseNotes: ReleaseNote[] = [
  // Feb 25, 2026 - TODAY
  {
    id: 'smart-go-backs',
    date: '2026-02-25',
    title: 'Smart Go-Back Scheduling',
    description: 'Auto-suggest optimal re-knock timing based on disposition. Track go-back conversion rates per setter.',
    icon: Clock,
    category: 'new',
    permissions: 'setters',
    howTo: [
      'Schedule a go-back from any lead',
      'See recommended timing based on disposition',
      'Not Home → 1 day, Interested → 2 days, Not Interested → 7 days',
      'Track conversion in setter stats',
    ],
  },
  {
    id: 'manual-booking-button',
    date: '2026-02-25',
    title: 'Manual Appointment Booking Button',
    description: 'New button in lead detail panel to manually book appointments via LeadConnector widget.',
    icon: Calendar,
    category: 'new',
    permissions: 'setters',
    howTo: [
      'Click on any lead pin',
      'Scroll to bottom of lead details',
      'Click "Book Appointment Manually"',
      'Opens LeadConnector booking widget',
    ],
  },
  {
    id: 'accurate-dashboard-metrics',
    date: '2026-02-25',
    title: 'Accurate Team Dashboard Metrics',
    description: 'Uses dynamic disposition settings. Shows Appt % Convos and Appt % Knocks metrics.',
    icon: BarChart3,
    category: 'fix',
    permissions: 'managers',
    howTo: [
      'Go to Tools → Team Stats',
      'Metrics now calculate from disposition settings',
      'Knocks = leads with disposition where countsAsDoorKnock = true',
      'Shows Appt % Convos and Appt % Knocks',
    ],
  },
  {
    id: 'gps-location',
    date: '2026-02-25',
    title: 'GPS Location + Red Person Icon',
    description: 'Sales/manager accounts default to GPS location. A red person icon shows your exact position on the map in real-time.',
    icon: Navigation,
    category: 'new',
    permissions: 'all',
    howTo: [
      'Log in to the app',
      'Map centers on your GPS location',
      'Red person icon shows your position',
      'Icon updates as you move',
    ],
  },
  {
    id: 'satellite-imagery',
    date: '2026-02-25',
    title: 'Satellite Imagery',
    description: 'Default map view is now satellite imagery with toggle to street view.',
    icon: MapPin,
    category: 'new',
    permissions: 'all',
    howTo: [
      'Open the map',
      'Default view is satellite',
      'Toggle to switch views',
    ],
  },
  {
    id: 'territory-assignment',
    date: '2026-02-25',
    title: 'Territory Assignment System',
    description: 'Draw polygon areas to assign territories to users. Leads in that area auto-assign.',
    icon: Zap,
    category: 'new',
    permissions: 'managers',
    howTo: [
      'Go to Lead Management',
      'Draw polygon on map',
      'Select user to assign',
      'All leads in territory auto-assign',
    ],
  },
  {
    id: 'team-activity-map',
    date: '2026-02-25',
    title: 'Team Activity Map',
    description: 'Track daily door knock trails with GPS. See route visualization on map.',
    icon: Clock,
    category: 'new',
    permissions: 'managers',
    howTo: [
      'Go to Tools → Team Map',
      'View team member routes',
      'See timeline of activity',
    ],
  },
  {
    id: 'distance-verification',
    date: '2026-02-25',
    title: 'GPS Distance Verification',
    description: 'Block disposition if too far from lead address. Shows distance in feet.',
    icon: Shield,
    category: 'fix',
    permissions: 'all',
    howTo: [
      'GPS verifies your distance',
      'Shows distance in feet',
      'Blocks disposition if too far',
    ],
  },
  {
    id: 'admin-user-edit-fix',
    date: '2026-02-25',
    title: 'Admin User Edit Bug Fix',
    description: 'Fixed issue where admin couldn\'t update user info.',
    icon: Users,
    category: 'fix',
    permissions: 'admins',
    howTo: [
      'Go to Admin → Users',
      'Click user to edit',
      'Save changes',
    ],
  },
  {
    id: 'manual-pin-drop-fix',
    date: '2026-02-25',
    title: 'Manual Pin Drop Bug Fix',
    description: 'Fixed bug where manually adding pins wasn\'t saving.',
    icon: MapPin,
    category: 'fix',
    permissions: 'all',
    howTo: [
      'Click and hold to drop pin',
      'Fill in details',
      'Pin now saves correctly',
    ],
  },
  {
    id: 'api-key-rotation',
    date: '2026-02-25',
    title: 'Google API Key Rotation',
    description: 'Rotated leaked Google API key. All APIs working.',
    icon: Zap,
    category: 'fix',
    permissions: 'all',
    howTo: [
      'All APIs working (Solar, Geocoding, Routes)',
    ],
  },
  
  // Feb 24, 2026
  {
    id: 'mobile-dashboard',
    date: '2026-02-24',
    title: 'Mobile Performance Dashboard',
    description: 'Track personal stats on the go!',
    icon: TrendingUp,
    category: 'new',
    permissions: 'all',
    howTo: ['Open app', 'Tap My Data'],
  },
  {
    id: 'lead-management',
    date: '2026-02-24',
    title: 'Lead Management Tool',
    description: 'Managers can bulk unclaim leads.',
    icon: Users,
    category: 'new',
    permissions: 'managers',
    howTo: ['Tools → Lead Management'],
  },
  
  // Older
  {
    id: 'go-backs',
    date: '2026-02-20',
    title: 'Go Backs Scheduling',
    description: 'Schedule leads to revisit later.',
    icon: Calendar,
    category: 'new',
    permissions: 'all',
    howTo: ['Select Go Back disposition'],
  },
];

// Get unique dates sorted descending
const getDates = () => {
  const dates = [...new Set(releaseNotes.map(n => n.date))];
  return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
};

// Helper functions outside component
const getPermissionColor = (permissions?: string) => {
  switch (permissions) {
    case 'all':
      return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'setters':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'managers':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'admins':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

const getPermissionLabel = (permissions?: string) => {
  switch (permissions) {
    case 'all':
      return 'All';
    case 'setters':
      return 'Setters/Closers';
    case 'managers':
      return 'Managers';
    case 'admins':
      return 'Admins';
    default:
      return 'All';
  }
};

export default function ReleaseNotesPage() {
  const router = useRouter();
  const dates = getDates();
  
  // State for accordion - all dates open by default
  const [openDates, setOpenDates] = useState<{ [key: string]: boolean }>(() => {
    const initial: { [key: string]: boolean } = {};
    dates.forEach(d => initial[d] = true);
    return initial;
  });
  
  // State for category toggles
  const [openCategories, setOpenCategories] = useState<{ [key: string]: boolean }>({
    'new': true,
    'fix': true,
  });

  const toggleDate = (date: string) => {
    setOpenDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  const toggleCategory = (category: string) => {
    setOpenCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const getNotesByDateAndCategory = (date: string, category?: string) => {
    let notes = releaseNotes.filter(n => n.date === date);
    if (category === 'new') {
      notes = notes.filter(n => n.category === 'new' || n.category === 'improvement');
    } else if (category === 'fix') {
      notes = notes.filter(n => n.category === 'fix');
    }
    return notes;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'new':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'improvement':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'fix':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const isMostRecent = (date: string) => date === dates[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F7FAFC] to-[#EDF2F7]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={() => router.push('/tools')}
            className="inline-flex items-center gap-2 text-[#4299E1] hover:text-[#3182CE] mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tools
          </button>
          <h1 className="text-3xl font-bold text-[#2D3748]">Release Notes</h1>
          <p className="text-[#718096]">What's new in Raydar</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        {dates.map((date) => {
          const isOpen = openDates[date] || false;
          const isRecent = isMostRecent(date);
          const newNotes = getNotesByDateAndCategory(date, 'new');
          const fixNotes = getNotesByDateAndCategory(date, 'fix');

          return (
            <div key={date} className="bg-white rounded-xl shadow-md border border-[#E2E8F0] overflow-hidden">
              {/* Date Header */}
              <button
                onClick={() => toggleDate(date)}
                className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-[#FF5F5A] to-[#F27141] text-white hover:from-[#E54A49] hover:to-[#E16332] transition-all"
              >
                <span className="text-lg font-bold">{formatDate(date)}</span>
                {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>

              {/* Accordion Content */}
              {isOpen && (
                <div className="p-4 space-y-4">
                  {isRecent ? (
                    <>
                      {newNotes.length > 0 && (
                        <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleCategory('new')}
                            className="w-full px-4 py-3 flex items-center justify-between bg-green-50 hover:bg-green-100 transition-colors"
                          >
                            <span className="font-semibold text-green-700 flex items-center gap-2">
                              <Sparkles className="w-4 h-4" />
                              New Features ({newNotes.length})
                            </span>
                            {openCategories['new'] ? <ChevronDown className="w-4 h-4 text-green-600" /> : <ChevronRight className="w-4 h-4 text-green-600" />}
                          </button>
                          {openCategories['new'] && (
                            <div className="divide-y divide-[#E2E8F0]">
                              {newNotes.map(note => (
                                <NoteItem key={note.id} note={note} getCategoryColor={getCategoryColor} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {fixNotes.length > 0 && (
                        <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleCategory('fix')}
                            className="w-full px-4 py-3 flex items-center justify-between bg-orange-50 hover:bg-orange-100 transition-colors"
                          >
                            <span className="font-semibold text-orange-700 flex items-center gap-2">
                              <Bug className="w-4 h-4" />
                              Bug Fixes ({fixNotes.length})
                            </span>
                            {openCategories['fix'] ? <ChevronDown className="w-4 h-4 text-orange-600" /> : <ChevronRight className="w-4 h-4 text-orange-600" />}
                          </button>
                          {openCategories['fix'] && (
                            <div className="divide-y divide-[#E2E8F0]">
                              {fixNotes.map(note => (
                                <NoteItem key={note.id} note={note} getCategoryColor={getCategoryColor} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="divide-y divide-[#E2E8F0]">
                      {getNotesByDateAndCategory(date).map(note => (
                        <NoteItem key={note.id} note={note} getCategoryColor={getCategoryColor} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-[#E2E8F0] py-8 mt-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-sm text-[#718096]">Questions or feedback? Contact your team lead.</p>
        </div>
      </div>
    </div>
  );
}

// Note Item Component
function NoteItem({ note, getCategoryColor }: { note: ReleaseNote; getCategoryColor: (cat: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = note.icon;
  const permColor = getPermissionColor(note.permissions);
  const permLabel = getPermissionLabel(note.permissions);

  return (
    <div className="p-4 hover:bg-[#F7FAFC] transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 text-left"
      >
        <div className="w-10 h-10 bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-[#2D3748]">{note.title}</h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getCategoryColor(note.category)}`}>
              {note.category === 'improvement' ? 'IMPROVEMENT' : note.category.toUpperCase()}
            </span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${permColor}`}>
              {permLabel}
            </span>
          </div>
          <p className="text-sm text-[#718096]">{note.description}</p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-[#718096] flex-shrink-0 mt-2" /> : <ChevronRight className="w-4 h-4 text-[#718096] flex-shrink-0 mt-2" />}
      </button>
      
      {expanded && note.howTo && (
        <div className="mt-3 ml-13 bg-[#F7FAFC] rounded-lg p-3">
          <p className="text-xs font-semibold text-[#2D3748] mb-2">How to use:</p>
          <ol className="text-sm text-[#718096] space-y-1">
            {note.howTo.map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[#FF5F5A] font-medium">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
