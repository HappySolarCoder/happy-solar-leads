'use client';

import { useState } from 'react';
import { X, Calendar, Clock, FileText } from 'lucide-react';
import { format } from 'date-fns';

interface GoBackScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: GoBackScheduleData) => void;
  leadAddress: string;
}

export interface GoBackScheduleData {
  date: Date;
  time?: string;
  notes?: string;
}

export default function GoBackScheduleModal({
  isOpen,
  onClose,
  onSave,
  leadAddress,
}: GoBackScheduleModalProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string>('');

  if (!isOpen) return null;

  const handleSave = () => {
    // Validate date is required
    if (!selectedDate) {
      setError('Please select a date');
      return;
    }

    const scheduleData: GoBackScheduleData = {
      date: new Date(selectedDate),
      time: selectedTime || undefined,
      notes: notes || undefined,
    };

    onSave(scheduleData);
    handleClose();
  };

  const handleClose = () => {
    setSelectedDate('');
    setSelectedTime('');
    setNotes('');
    setError('');
    onClose();
  };

  // Get min date (today)
  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#2D3748]">Schedule Go Back</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#718096]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Lead Address */}
          <div className="bg-[#F7FAFC] rounded-lg p-4">
            <p className="text-sm text-[#718096] mb-1">Lead Address</p>
            <p className="font-medium text-[#2D3748]">{leadAddress}</p>
          </div>

          {/* Date Picker */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[#2D3748] mb-2">
              <Calendar className="w-4 h-4 text-[#FF5F5A]" />
              Date <span className="text-[#FF5F5A]">*</span>
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setError('');
              }}
              min={today}
              className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
            />
          </div>

          {/* Time Picker (Optional) */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[#2D3748] mb-2">
              <Clock className="w-4 h-4 text-[#718096]" />
              Time <span className="text-[#718096] text-xs">(optional)</span>
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[#2D3748] mb-2">
              <FileText className="w-4 h-4 text-[#718096]" />
              Notes <span className="text-[#718096] text-xs">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this go back..."
              rows={3}
              className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 border border-[#E2E8F0] rounded-lg text-[#718096] hover:bg-[#F7FAFC] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-[#FF5F5A] text-white rounded-lg hover:bg-[#E54E49] transition-colors font-medium"
          >
            Schedule Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
