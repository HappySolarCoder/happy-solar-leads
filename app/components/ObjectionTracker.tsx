'use client';

import { useState } from 'react';
import { AlertCircle, MessageSquare, X } from 'lucide-react';
import { Lead, ObjectionType, OBJECTION_LABELS, OBJECTION_COLORS } from '@/app/types';

interface ObjectionTrackerProps {
  lead: Lead;
  currentUserId: string;
  onSave: (objectionType: ObjectionType, notes: string) => void;
  onClose: () => void;
}

export default function ObjectionTracker({ lead, currentUserId, onSave, onClose }: ObjectionTrackerProps) {
  console.log('[DEBUG] ObjectionTracker component mounted/rendered');
  const [selectedType, setSelectedType] = useState<ObjectionType | ''>(lead.objectionType || '');
  const [notes, setNotes] = useState(lead.objectionNotes || '');

  const handleSave = () => {
    if (!selectedType) {
      alert('Please select an objection type');
      return;
    }
    onSave(selectedType as ObjectionType, notes);
  };

  const objectionTypes = Object.keys(OBJECTION_LABELS) as ObjectionType[];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-8 max-h-[calc(100vh-4rem)] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-pink-600 p-6 text-white sticky top-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6" />
              <h2 className="text-2xl font-bold">Record Objection</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-white/90 mt-2">
            Track why {lead.name} isn't interested to improve future conversations
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Objection Type Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              What was the main objection? *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {objectionTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`
                    flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left
                    ${selectedType === type 
                      ? 'border-red-500 bg-red-50 shadow-md' 
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                    }
                  `}
                >
                  <div 
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: OBJECTION_COLORS[type] }}
                  />
                  <div className="flex-1">
                    <div className={`font-medium ${selectedType === type ? 'text-red-700' : 'text-gray-900'}`}>
                      {OBJECTION_LABELS[type]}
                    </div>
                  </div>
                  {selectedType === type && (
                    <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Additional Notes (Optional)
            </label>
            <div className="relative">
              <MessageSquare className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any specific details about the objection? (e.g., 'Roof needs replacement in 2 years', 'Current bill is only $80/month')"
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                rows={4}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              These notes help train setters on how to handle similar objections
            </p>
          </div>

          {/* Existing Objection Info */}
          {lead.objectionType && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900 mb-1">
                    Previous Objection Recorded
                  </p>
                  <p className="text-sm text-amber-700">
                    <span className="font-medium">{OBJECTION_LABELS[lead.objectionType]}</span>
                    {lead.objectionRecordedAt && (
                      <span className="text-amber-600">
                        {' '}· {new Date(lead.objectionRecordedAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                  {lead.objectionNotes && (
                    <p className="text-sm text-amber-600 mt-2 italic">
                      "{lead.objectionNotes}"
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!selectedType}
              className={`
                flex-1 px-4 py-3 font-semibold rounded-lg transition-colors
                ${selectedType
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }
              `}
            >
              Save Objection
            </button>
          </div>
        </div>

        {/* Tips Section */}
        <div className="bg-gray-50 p-6 border-t">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">💡 Why Track Objections?</h3>
          <ul className="text-sm text-gray-600 space-y-2">
            <li>• <strong>Coaching:</strong> See which objections each setter struggles with</li>
            <li>• <strong>Training:</strong> Build scripts for common objections</li>
            <li>• <strong>Territory Insights:</strong> Understand area-specific concerns</li>
            <li>• <strong>Lead Quality:</strong> Improve future lead sourcing based on patterns</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
