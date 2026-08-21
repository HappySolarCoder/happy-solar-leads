'use client';

import { useEffect, useState } from 'react';
import { X, MapPin, Loader, Home, Phone, Mail, DollarSign } from 'lucide-react';
import { Lead } from '@/app/types';
import { getDispositionsAsync } from '@/app/utils/dispositions';
import { DEFAULT_DISPOSITIONS, type Disposition } from '@/app/types/disposition';

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (lead: Partial<Lead>) => Promise<void>;
  initialAddress?: string;
  initialCity?: string;
  initialState?: string;
  initialZip?: string;
  lat: number;
  lng: number;
}

const PLACEHOLDER_NAME = 'john smith';
const PLACEHOLDER_STREET = '123 main st';

function isBlankOrPlaceholder(value: string, placeholder: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed.toLowerCase() === placeholder;
}

function getSaveLeadValidationError(name: string, address: string): string | null {
  // Empty / whitespace-only name is allowed. Exact placeholder "John Smith" is still junk.
  const nameIsPlaceholder = name.trim().toLowerCase() === PLACEHOLDER_NAME;
  const streetBad = isBlankOrPlaceholder(address, PLACEHOLDER_STREET);
  if (nameIsPlaceholder || streetBad) {
    return 'Enter a real name and street address. Placeholder text cannot be saved.';
  }
  return null;
}

function filterAddLeadDispositions(rows: Disposition[]): Disposition[] {
  return rows
    .filter((d) => d.id !== 'claimed' && d.id !== 'unclaimed')
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

const SEEDED_ADD_LEAD_DISPOSITIONS = filterAddLeadDispositions(DEFAULT_DISPOSITIONS);

export default function AddLeadModal({
  isOpen,
  onClose,
  onSave,
  initialAddress = '',
  initialCity = '',
  initialState = '',
  initialZip = '',
  lat,
  lng,
}: AddLeadModalProps) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState(initialAddress);
  const [city, setCity] = useState(initialCity);
  const [state, setState] = useState(initialState);
  const [zip, setZip] = useState(initialZip);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [estimatedBill, setEstimatedBill] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>(SEEDED_ADD_LEAD_DISPOSITIONS);
  const [selectedDisposition, setSelectedDisposition] = useState(SEEDED_ADD_LEAD_DISPOSITIONS[0]?.id ?? '');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getDispositionsAsync()
      .then((rows) => {
        if (cancelled) return;
        const options = filterAddLeadDispositions(rows);
        // Empty filtered Firestore list must not wipe the seeded knock options.
        if (options.length === 0) return;
        setDispositions(options);
        setSelectedDisposition((current) =>
          current && options.some((d) => d.id === current) ? current : options[0].id
        );
      })
      .catch(() => {
        // Keep seeded defaults — never setDispositions([]).
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setAddress((prev) => prev || initialAddress);
    setCity((prev) => prev || initialCity);
    setState((prev) => prev || initialState);
    setZip((prev) => prev || initialZip);
    setSaveError(null);
  }, [isOpen, initialAddress, initialCity, initialState, initialZip]);

  if (!isOpen) return null;

  const saveValidationError = getSaveLeadValidationError(name, address);
  const canSaveLead = !saveValidationError;

  const handleSave = async () => {
    const validationError = getSaveLeadValidationError(name, address);
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    if (!selectedDisposition) {
      setSaveError('Please select a disposition.');
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const selectedDispositionObj = dispositions.find(d => d.id === selectedDisposition);
      const dispositionedAt = selectedDisposition ? new Date() : undefined;
      const leadData: Partial<Lead> = {
        name: name.trim(),
        address: address.trim(),
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        zip: zip.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        estimatedBill: estimatedBill ? parseFloat(estimatedBill) : undefined,
        lat,
        lng,
        status: selectedDisposition,
        disposition: selectedDispositionObj?.name || selectedDisposition,
        dispositionedAt,
        createdAt: new Date(),
      };

      await onSave(leadData);
      
      // Close and reset
      onClose();
      setName('');
      setAddress(initialAddress);
      setCity(initialCity);
      setState(initialState);
      setZip(initialZip);
      setPhone('');
      setEmail('');
      setEstimatedBill('');
      setSaveError(null);
      setSelectedDisposition(dispositions[0]?.id || selectedDisposition);
    } catch (error) {
      console.error('Error saving lead:', error);
      setSaveError('Failed to save lead. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div 
          className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#FF5F5A]/10 rounded-lg">
                <MapPin className="w-5 h-5 text-[#FF5F5A]" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#2D3748]">Add New Lead</h2>
                <p className="text-xs text-[#718096]">Dropped pin location</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#718096]" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* GPS Coordinates */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <div className="flex items-center gap-2 text-blue-800">
                <MapPin className="w-4 h-4" />
                <span className="font-semibold">GPS:</span>
                <span>{lat.toFixed(6)}, {lng.toFixed(6)}</span>
              </div>
            </div>

            {/* Disposition (Required) */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Disposition <span className="text-[#FF5F5A]">*</span>
              </label>
              <select
                value={selectedDisposition}
                onChange={(e) => setSelectedDisposition(e.target.value)}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10 bg-white"
              >
                {dispositions.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Name
              </label>
              <div className="relative">
                <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (saveError) setSaveError(null);
                  }}
                  placeholder="John Smith"
                  className="w-full pl-10 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
              </div>
            </div>

            {/* Address (Required) */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Street Address <span className="text-[#FF5F5A]">*</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  if (saveError) setSaveError(null);
                }}
                placeholder="123 Main St"
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              />
            </div>

            {/* City, State, Zip (Required) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  City <span className="text-[#FF5F5A]">*</span>
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Rochester"
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  State <span className="text-[#FF5F5A]">*</span>
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="NY"
                  maxLength={2}
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10 uppercase"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  Zip <span className="text-[#FF5F5A]">*</span>
                </label>
                <input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="14612"
                  maxLength={5}
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
              </div>
            </div>

            {/* Phone (Optional) */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Phone (Optional)
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(585) 555-1234"
                  className="w-full pl-10 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
              </div>
            </div>

            {/* Email (Optional) */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Email (Optional)
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@email.com"
                  className="w-full pl-10 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
              </div>
            </div>

            {/* Estimated Bill (Optional) */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Estimated Bill (Optional)
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="number"
                  value={estimatedBill}
                  onChange={(e) => setEstimatedBill(e.target.value)}
                  placeholder="150"
                  className="w-full pl-10 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#718096]">/mo</span>
              </div>
            </div>

            {/* Info Box */}
            <div className="p-3 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg text-xs text-[#718096]">
              <p><strong>Note:</strong> Solar potential will be calculated automatically after saving.</p>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-6 py-4 space-y-3">
            {(saveError || !canSaveLead) && (
              <p className="text-sm text-[#FF5F5A]" role="alert">
                {saveError || saveValidationError}
              </p>
            )}
            <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 px-4 py-3 border-2 border-[#E2E8F0] text-[#2D3748] font-semibold rounded-lg hover:bg-[#F7FAFC] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !canSaveLead}
              className="flex-1 px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Lead'
              )}
            </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
