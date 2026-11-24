'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { isProximityWarningCancelled } from '@/app/field/proximityWarning';
import {
  ASSISTANCE_HELPER,
  ASSISTANCE_PROGRAMS,
  CATEGORICAL_TIER1_NOTE,
  EMPOWER_MAX_HOUSEHOLD,
  ESTIMATE_NOTE,
  NOT_SURE_LABEL,
  NY_COUNTIES,
  SSI_HELPER,
  bandChoices,
  buildEmpowerBumpPayload,
  knownCounty,
  programsForceTier1,
  resolveEmpowerZip,
  type EmpowerBumpPayload,
  type EstimatedBand,
} from '@/app/empower/bumpLogic';
import { empowerNotice, type EmpowerOutcome } from '@/app/empower/empowerBump';

interface EmpowerBumpFormProps {
  lead: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    postalCode?: string;
    zipCode?: string;
    zipcode?: string;
    county?: string;
    homeowner?: {
      mailingZip?: string;
      address?: string;
      addressNorm?: string;
      state?: string;
    };
  };
  homeowner?: {
    mailingZip?: string;
    address?: string;
    addressNorm?: string;
    state?: string;
  };
  town?: string;
  onClose: () => void;
  onSubmit: (payload: EmpowerBumpPayload) => Promise<EmpowerOutcome>;
}

const fieldClass = 'w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14b8a6] focus:border-transparent';

export default function EmpowerBumpForm({ lead, homeowner, town, onClose, onSubmit }: EmpowerBumpFormProps) {
  const [name, setName] = useState(lead.name || '');
  const [phone, setPhone] = useState(lead.phone || '');
  const [email, setEmail] = useState(lead.email || '');
  const [householdSize, setHouseholdSize] = useState<number | ''>('');
  const [county, setCounty] = useState(() => knownCounty({
    county: lead.county,
    address: lead.address,
    city: lead.city,
    town,
  }));
  const derivedZip = resolveEmpowerZip({
    ...lead,
    homeowner: homeowner || lead.homeowner,
  });
  const [zip, setZip] = useState(derivedZip);
  const zipNeedsEntry = !derivedZip;
  const [band, setBand] = useState<EstimatedBand | ''>('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [assistanceNone, setAssistanceNone] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const draftId = useRef<string | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const categorical = programsForceTier1(programs);
  const dollarChoices = bandChoices(county, typeof householdSize === 'number' ? householdSize : 0);
  const tier1Choice = dollarChoices.find((choice) => choice.id === 'tier1');
  const choices = categorical
    ? [tier1Choice ?? { id: 'tier1' as const, label: 'Tier 1 (est.)' }]
    : dollarChoices;
  const selectedBand: EstimatedBand | '' = categorical ? 'tier1' : band;

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const handleSubmit = async () => {
    const actedAt = new Date().toISOString();
    if (!draftId.current) draftId.current = crypto.randomUUID();
    if (sending.current) return;
    const built = buildEmpowerBumpPayload({
      draftId: draftId.current,
      actedAt,
      leadId: lead.id,
      name,
      phone,
      email,
      address: lead.address || '',
      city: lead.city || '',
      state: lead.state || '',
      zip,
      town,
      county,
      householdSize: typeof householdSize === 'number' ? householdSize : 0,
      estimatedBand: selectedBand,
      assistancePrograms: programs,
      assistanceNone,
      confirmedContact: confirmed,
    });
    if (!built.ok) {
      setError(built.message);
      return;
    }
    sending.current = true;
    setSaving(true);
    setError('');
    try {
      const outcome = await onSubmit(built.payload);
      if (!mounted.current || outcome.attempted) return;
      setError(empowerNotice(outcome));
    } catch (caught) {
      if (!mounted.current || isProximityWarningCancelled(caught)) return;
      const message = caught instanceof Error ? caught.message : '';
      setError(message || 'Couldn’t save this bump.');
    } finally {
      sending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" role="dialog" aria-labelledby="empower-bump-title">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 id="empower-bump-title" className="text-xl font-semibold text-[#2D3748]">Empower Bump</h2>
          <button aria-label="Close" data-raydar-back-close type="button" onClick={onClose} className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors">
            <X className="w-5 h-5 text-[#718096]" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-[#4A5568]">{ESTIMATE_NOTE}</p>
          <div className="bg-[#F7FAFC] rounded-lg p-4">
            <p className="text-sm text-[#718096] mb-1">Door</p>
            <p className="font-medium text-[#2D3748]">{lead.address}</p>
            <p className="text-sm text-[#4A5568]">{[lead.city, lead.state, derivedZip || zip].filter(Boolean).join(' ')}</p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#2D3748]">Name <span className="text-[#FF5F5A]">*</span></span>
            <input aria-label="Name" className={`${fieldClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#2D3748]">Phone <span className="text-[#FF5F5A]">*</span></span>
            <input aria-label="Phone" className={`${fieldClass} mt-1`} value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#2D3748]">Email <span className="text-[#FF5F5A]">*</span></span>
            <input aria-label="Email" className={`${fieldClass} mt-1`} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" />
            <p className="mt-1 text-sm font-semibold text-[#C53030]">(NO FAKE EMAILS)</p>
          </label>
          {zipNeedsEntry ? (
            <label className="block">
              <span className="text-sm font-medium text-[#2D3748]">ZIP <span className="text-[#FF5F5A]">*</span></span>
              <input aria-label="ZIP" className={`${fieldClass} mt-1`} value={zip} onChange={(event) => setZip(event.target.value)} autoComplete="postal-code" inputMode="numeric" />
            </label>
          ) : null}

          <label className="block">
            <span className="text-sm font-medium text-[#2D3748]">Household members <span className="text-[#FF5F5A]">*</span></span>
            <select
              aria-label="Household members"
              className={`${fieldClass} mt-1`}
              value={householdSize}
              onChange={(event) => {
                const next = Number(event.target.value);
                setHouseholdSize(Number.isInteger(next) && next >= 1 ? next : '');
              }}
            >
              <option value="">Select</option>
              {Array.from({ length: EMPOWER_MAX_HOUSEHOLD }, (_, index) => index + 1).map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#2D3748]">County</span>
            <select aria-label="County" className={`${fieldClass} mt-1`} value={county} onChange={(event) => setCounty(event.target.value)}>
              <option value="">Select a New York county</option>
              {NY_COUNTIES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <p className="mt-2 text-sm text-[#4A5568]">Required before a band other than Not sure can be chosen.</p>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#2D3748]">Income band <span className="text-[#718096] text-xs">(optional)</span></span>
            <select
              aria-label="Income band"
              className={`${fieldClass} mt-1`}
              value={selectedBand}
              disabled={categorical}
              onChange={(event) => setBand(event.target.value as EstimatedBand | '')}
            >
              <option value="">Select</option>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
            {categorical ? <p className="mt-2 text-sm font-semibold text-[#0F766E]" role="status">{CATEGORICAL_TIER1_NOTE}</p> : null}
            {selectedBand === 'not_sure' ? <p className="mt-2 text-sm text-[#4A5568]">{ESTIMATE_NOTE}</p> : null}
          </label>

          <fieldset aria-labelledby="empower-assistance-legend">
            <legend id="empower-assistance-legend" className="text-sm font-medium text-[#2D3748]">Government assistance</legend>
            <label htmlFor="empower-assistance-none" className="mt-2 flex items-start gap-2 text-sm text-[#2D3748]">
              <input
                id="empower-assistance-none"
                type="checkbox"
                className="mt-1"
                checked={assistanceNone}
                onChange={() => {
                  setAssistanceNone((current) => {
                    const next = !current;
                    if (next) setPrograms([]);
                    return next;
                  });
                }}
              />
              <span>None</span>
            </label>
            {ASSISTANCE_PROGRAMS.map((label, index) => (
              <div key={label} className="mt-2">
                <label htmlFor={`empower-assistance-${index}`} className="flex items-start gap-2 text-sm text-[#2D3748]">
                  <input
                    id={`empower-assistance-${index}`}
                    type="checkbox"
                    className="mt-1"
                    checked={programs.includes(label)}
                    onChange={() => {
                      setAssistanceNone(false);
                      setPrograms((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
                    }}
                  />
                  <span>{label}</span>
                </label>
                {label.startsWith('SSI (') ? <p className="ml-6 text-sm text-[#4A5568]">{SSI_HELPER}</p> : null}
              </div>
            ))}
            <p className="mt-2 text-sm text-[#4A5568]">{ASSISTANCE_HELPER}</p>
          </fieldset>

          <label htmlFor="empower-contact-confirmed" className="flex items-start gap-2 text-sm text-[#2D3748]">
            <input id="empower-contact-confirmed" type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>Name, phone, and email are correct.</span>
          </label>

          {dollarChoices.length === 1 && !categorical ? <p className="text-sm text-[#4A5568]">Choose household size and county to see estimated dollar bands. {NOT_SURE_LABEL} stays available.</p> : null}
          {error ? <p className="text-sm font-semibold text-[#C53030]" role="alert">{error}</p> : null}
        </div>
        <div className="border-t px-6 py-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-[#E2E8F0] rounded-lg text-[#718096] hover:bg-[#F7FAFC]">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 px-4 py-2 bg-[#14b8a6] text-white rounded-lg font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Empower Bump'}
          </button>
        </div>
      </div>
    </div>
  );
}
