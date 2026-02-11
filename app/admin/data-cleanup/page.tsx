'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Trash2, Archive, RefreshCw, AlertTriangle } from 'lucide-react';

export default function DataCleanupPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-[#718096] hover:text-[#2D3748] mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Admin
          </button>
          <h1 className="text-3xl font-bold text-[#2D3748]">Data Cleanup & Maintenance</h1>
          <p className="text-[#718096] mt-2">Manage duplicate leads, stale data, and database optimization</p>
        </div>

        {/* Coming Soon Card */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center">
          <div className="w-20 h-20 bg-[#FF5F5A]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Trash2 className="w-10 h-10 text-[#FF5F5A]" />
          </div>
          <h2 className="text-2xl font-bold text-[#2D3748] mb-3">Coming Soon</h2>
          <p className="text-[#718096] max-w-md mx-auto mb-8">
            Automated data cleanup tools and maintenance utilities are currently being built.
          </p>

          {/* Features List */}
          <div className="max-w-2xl mx-auto text-left bg-[#F7FAFC] rounded-xl p-6 border border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-[#FF5F5A]" />
              Planned Features
            </h3>
            <ul className="space-y-3 text-sm text-[#718096]">
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Duplicate lead detection and merging</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Bulk delete stale leads (no activity in X days)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Archive old leads instead of deleting (recoverable)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Remove poor solar leads in bulk</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Data validation (fix incomplete addresses, phone numbers)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Database optimization and indexing</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Export/backup before cleanup operations</span>
              </li>
            </ul>
          </div>

          {/* Warning Box */}
          <div className="mt-8 max-w-2xl mx-auto">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-amber-900 mb-2">
                    Be Careful with Cleanup Operations
                  </h3>
                  <p className="text-xs text-amber-800">
                    Data cleanup tools will include safety features like previews, confirmations, and 
                    backup exports. We recommend archiving instead of deleting whenever possible to 
                    maintain data integrity and allow recovery.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Manual Cleanup Guide */}
          <div className="mt-8 max-w-2xl mx-auto">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-4 text-left flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#FF5F5A]" />
              Manual Cleanup (For Now)
            </h3>
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left text-sm text-[#718096]">
              <p className="mb-3">
                Until automated tools are ready, you can manually clean data:
              </p>
              <ol className="space-y-2 list-decimal list-inside">
                <li>Poor solar leads: Visible at bottom of main page with "Delete All" button</li>
                <li>Individual leads: Open lead detail panel → click delete (if available)</li>
                <li>Bulk operations: Use browser console or contact admin for database access</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
