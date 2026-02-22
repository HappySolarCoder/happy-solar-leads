'use client';

import { useState } from 'react';
import { ArrowLeft, Calendar, BarChart3, Users, Zap, TrendingUp } from 'lucide-react';
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
}

const releaseNotes: ReleaseNote[] = [
  // Today - Feb 21, 2026
  {
    id: 'mobile-dashboard',
    date: '2026-02-21',
    title: 'Mobile Performance Dashboard',
    description: 'Track your personal stats on the go! View your knocks, conversations, appointments, and see how you compare to the team.',
    icon: TrendingUp,
    screenshot: '/release-notes/mobile-dashboard.jpg',
    category: 'new',
    howTo: [
      'Open the mobile app',
      'Tap "My Data" from the home screen',
      'View your today\'s stats at the top (knocks, convos, appts)',
      'Scroll to see 7-day trends, team comparison, and achievements',
      'Track your conversion rates and personal bests',
    ],
  },
  {
    id: 'team-dashboard',
    date: '2026-02-21',
    title: 'Team Performance Dashboard',
    description: 'Managers can now see real-time team metrics with leaderboards, conversion funnels, and individual performance tracking.',
    icon: BarChart3,
    screenshot: '/release-notes/team-dashboard.jpg',
    category: 'new',
    howTo: [
      'Go to Tools → Team Stats',
      'Use time filters (Today, Week, Month, All) to view different periods',
      'See team overview cards showing total knocks, conversations, and appointments',
      'Check the conversion funnel to see drop-off rates',
      'View leaderboards for top performers',
      'Sort the individual performance table by knocks, conversations, or appointments',
    ],
  },
  {
    id: 'performance-optimization',
    date: '2026-02-21',
    title: 'Map Performance Improvements',
    description: 'The map now loads 70-90% faster with 17,000+ leads! Viewport-based rendering only shows pins you can see.',
    icon: Zap,
    category: 'improvement',
    howTo: [
      'Open the knocking map as usual',
      'Notice faster load times when panning and zooming',
      'The map now only loads markers in your current view',
      'Clustering improved for smoother performance',
    ],
  },
  
  // Yesterday - Feb 20, 2026
  {
    id: 'lead-management',
    date: '2026-02-20',
    title: 'Lead Management Tool',
    description: 'Managers can now bulk unclaim leads by user with an easy-to-use list interface.',
    icon: Users,
    screenshot: '/release-notes/lead-management.jpg',
    category: 'new',
    howTo: [
      'Go to Tools → Lead Management (managers only)',
      'Filter by user from the dropdown',
      'Tap "Select" to enter selection mode',
      'Check the leads you want to unclaim',
      'Tap "Unclaim X Leads" button',
      'Watch the progress bar as leads are processed',
    ],
  },
  {
    id: 'go-backs',
    date: '2026-02-20',
    title: 'Go Backs Scheduling',
    description: 'Schedule leads to revisit later with date, time, and notes. View all your scheduled go backs in a calendar or list.',
    icon: Calendar,
    screenshot: '/release-notes/go-backs.jpg',
    category: 'new',
    howTo: [
      'Open a lead and select "Go Back" disposition',
      'Pick a date (required) and optionally add a time',
      'Add notes about why you\'re going back',
      'Access your go backs: Tools → Go Backs',
      'View in calendar or list mode',
      'Tap any go back to see lead details',
    ],
  },
];

export default function ReleaseNotesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | '2026-02-21' | '2026-02-20'>('all');

  const filteredNotes = filter === 'all' 
    ? releaseNotes 
    : releaseNotes.filter(note => note.date === filter);

  const groupByDate = (notes: ReleaseNote[]) => {
    const groups: { [key: string]: ReleaseNote[] } = {};
    notes.forEach(note => {
      if (!groups[note.date]) {
        groups[note.date] = [];
      }
      groups[note.date].push(note);
    });
    return groups;
  };

  const grouped = groupByDate(filteredNotes);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F7FAFC] to-[#EDF2F7]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <button
            onClick={() => router.push('/tools')}
            className="inline-flex items-center gap-2 text-[#4299E1] hover:text-[#3182CE] mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tools
          </button>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[#2D3748] mb-2">Release Notes</h1>
              <p className="text-[#718096]">What's new in Raydar</p>
            </div>
            
            {/* Date Filter */}
            <div className="flex items-center gap-2 bg-[#F7FAFC] p-1 rounded-lg">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('2026-02-21')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === '2026-02-21'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setFilter('2026-02-20')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === '2026-02-20'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                Yesterday
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {Object.keys(grouped).sort().reverse().map(dateKey => (
          <div key={dateKey} className="mb-12">
            {/* Date Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-gradient-to-r from-[#FF5F5A] to-transparent" />
              <h2 className="text-2xl font-bold text-[#2D3748]">{formatDate(dateKey)}</h2>
              <div className="flex-1 h-px bg-gradient-to-l from-[#FF5F5A] to-transparent" />
            </div>

            {/* Features */}
            <div className="space-y-8">
              {grouped[dateKey].map((note) => {
                const Icon = note.icon;
                return (
                  <div
                    key={note.id}
                    className="bg-white rounded-xl shadow-lg overflow-hidden border border-[#E2E8F0] hover:shadow-xl transition-shadow"
                  >
                    {/* Screenshot (if available) */}
                    {note.screenshot && (
                      <div className="bg-gradient-to-br from-[#F7FAFC] to-[#EDF2F7] p-8 border-b border-[#E2E8F0]">
                        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-2 border border-[#CBD5E0]">
                          <img 
                            src={note.screenshot} 
                            alt={`${note.title} screenshot`}
                            className="w-full rounded"
                          />
                        </div>
                      </div>
                    )}

                    {/* Content */}
                    <div className="p-6 lg:p-8">
                      <div className="flex items-start gap-4 mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-2xl font-bold text-[#2D3748]">{note.title}</h3>
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${getCategoryColor(note.category)}`}>
                              {note.category.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[#718096] text-lg leading-relaxed">{note.description}</p>
                        </div>
                      </div>

                      {/* How To Use */}
                      <div className="bg-gradient-to-br from-[#F7FAFC] to-white rounded-lg p-6 border-2 border-[#E2E8F0]">
                        <h4 className="text-sm font-semibold text-[#2D3748] mb-3 flex items-center gap-2">
                          <span className="w-5 h-5 bg-[#4299E1] text-white rounded-full flex items-center justify-center text-xs">?</span>
                          How to Use
                        </h4>
                        <ol className="space-y-2">
                          {note.howTo.map((step, index) => (
                            <li key={index} className="flex items-start gap-3">
                              <span className="w-6 h-6 bg-[#FF5F5A] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                                {index + 1}
                              </span>
                              <span className="text-[#2D3748] flex-1">{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filteredNotes.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[#718096] text-lg">No release notes for this period</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-[#E2E8F0] py-8 mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm text-[#718096]">
            Questions or feedback? Contact your team lead or submit via the app.
          </p>
        </div>
      </div>
    </div>
  );
}
