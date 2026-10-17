'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Phone, Save, Send } from 'lucide-react';
import { Lead, User } from '@/app/types';
import { saveLeadAsync, getCurrentUserAsync, invalidateLeadsCache } from '@/app/utils/storage';
import { getAdminSettingsAsync } from '@/app/utils/adminSettings';
import { auth } from '@/app/utils/firebase';
import {
  FALLBACK_SCHEDULING_MANAGER_PHONE,
  schedulingManagerTelDigits,
} from '@/app/utils/schedulingManagerTel';
import {
  AMBIGUOUS_SEND_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  buildSchedulingPayload,
  schedulingBlockedFor,
  sendSchedulingNotification,
} from '@/app/utils/schedulingNotification';

interface LeadEditorModalProps {
  signedInRep?: User | null;
  beforeSend?: () => Promise<void>;
  saveLeadPatch?: (patch: Partial<Lead>) => Promise<void>;
  mobileMode?: boolean;
  pendingFieldWork?: boolean;
  fieldContext?: string;
  onInfoSent?: () => Promise<void>;
  lead: Lead;
  onClose: () => void;
  onSave: () => void;
}

export default function LeadEditorModal({ lead, onClose, onSave, beforeSend, signedInRep, fieldContext, onInfoSent, mobileMode = false, pendingFieldWork = false, saveLeadPatch }: LeadEditorModalProps) {
  const [formData, setFormData] = useState({
    name: lead.name,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    phone: lead.phone || '',
    email: lead.email || '',
    estimatedBill: lead.estimatedBill || '',
    notes: lead.notes || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [infoSent, setInfoSent] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [accountBlocked, setAccountBlocked] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const sendingRef = useRef(false);
  // Cached before the call tap. Reading this during the click must not await.
  const [schedulingManagerPhone, setSchedulingManagerPhone] = useState(FALLBACK_SCHEDULING_MANAGER_PHONE);
  const accountId = signedInRep?.id || auth?.currentUser?.uid || '';
  const blockedForAccount = accountBlocked || schedulingBlockedFor(accountId);

  // Load current user and scheduling-manager phone when the modal mounts.
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const user = signedInRep || await getCurrentUserAsync();
      if (!cancelled) setCurrentUser(user);
    }

    async function loadSchedulingManagerPhone() {
      try {
        const settings = await getAdminSettingsAsync();
        const phone = settings?.schedulingManagerPhone?.trim();
        if (!cancelled && phone) setSchedulingManagerPhone(phone);
      } catch {
        // Denied or offline: keep FALLBACK_SCHEDULING_MANAGER_PHONE. Do not disable Send.
      }
    }

    loadUser();
    loadSchedulingManagerPhone();

    return () => {
      cancelled = true;
    };
  }, [signedInRep]);

  useEffect(() => {
    if (cooldownUntil <= 0) return;
    const id = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= cooldownUntil) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const handleSave = async () => {
    if (mobileMode && pendingFieldWork) { alert('Sync or review this pin’s pending changes in Field tools before editing contact details. You can still send the scheduling information.'); return; }
    setIsSaving(true);

    try {
      const updatedLead: Lead = {
        ...lead,
        name: formData.name,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        zip: formData.zip,
        phone: formData.phone || undefined,
        email: formData.email || undefined,
        estimatedBill: formData.estimatedBill ? Number(formData.estimatedBill) : undefined,
        notes: formData.notes || undefined,
      };

      if (saveLeadPatch) {
        await saveLeadPatch({ name: formData.name, address: formData.address, city: formData.city, state: formData.state, zip: formData.zip, phone: formData.phone || '', email: formData.email || '', notes: formData.notes || '', ...(formData.estimatedBill ? { estimatedBill: Number(formData.estimatedBill) } : {}) });
      } else if (mobileMode) {
        const { updateLeadAsync } = await import('@/app/utils/storage');
        await updateLeadAsync(lead.id, { name: formData.name, address: formData.address, city: formData.city, state: formData.state, zip: formData.zip, phone: formData.phone || '', email: formData.email || '', notes: formData.notes || '', ...(formData.estimatedBill ? { estimatedBill: Number(formData.estimatedBill) } : {}) });
      } else await saveLeadAsync(updatedLead);
      invalidateLeadsCache(); // Ensure fresh data after update
      onSave();
    } catch (error) {
      alert(`Changes could not be saved. ${(error as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInfo = async () => {
    if (sendingRef.current || isSending) return;
    const uid = signedInRep?.id || auth?.currentUser?.uid || '';
    if (blockedForAccount || schedulingBlockedFor(uid)) return;
    if (cooldownUntil > Date.now()) return;
    sendingRef.current = true;
    setIsSending(true);
    setSendNotice(null);

    try {
      const built = buildSchedulingPayload(formData, lead, fieldContext);
      if (!built.ok) {
        alert(built.message);
        return;
      }

      let user = signedInRep || currentUser;
      if (!user) {
        try {
          user = await getCurrentUserAsync();
        } catch {
          setSendNotice(SIGN_IN_AGAIN_MESSAGE);
          return;
        }
      }
      if (mobileMode && (!user || auth?.currentUser?.uid !== user.id)) {
        setSendNotice(SIGN_IN_AGAIN_MESSAGE);
        return;
      }

      // Persist the lead before the notification so the request has a real visit.
      try {
        if (saveLeadPatch) await saveLeadPatch({ name: formData.name, address: formData.address, city: formData.city, state: formData.state, zip: formData.zip, phone: formData.phone || '', email: formData.email || '', notes: formData.notes || '', ...(formData.estimatedBill ? { estimatedBill: Number(formData.estimatedBill) } : {}) });
        await beforeSend?.();
      } catch (error) {
        alert(`Changes could not be saved. ${(error as Error).message}`);
        return;
      }

      const outcome = await sendSchedulingNotification(built.payload, {
        accountId: uid,
        getToken: async (forceRefresh) => {
          const current = auth?.currentUser;
          if (!current) throw new Error('signed-out');
          return current.getIdToken(forceRefresh);
        },
      });

      if (outcome.status === 'sent') {
        setInfoSent(true);
        void onInfoSent?.().catch(() => {});
        return;
      }
      if (outcome.status === 'blocked') {
        setAccountBlocked(true);
        setSendNotice(outcome.message);
        return;
      }
      if (outcome.status === 'rateLimited') {
        const until = Date.now() + outcome.retryAfterSec * 1000;
        setCooldownUntil(until);
        setNow(Date.now());
        return;
      }
      setSendNotice(outcome.message);
    } catch {
      setSendNotice(AMBIGUOUS_SEND_MESSAGE);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const schedulingManagerTel = `tel:${schedulingManagerTelDigits(schedulingManagerPhone)}`;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-[120]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[121] flex items-center justify-center p-4 pointer-events-none">
        <div 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#2D3748]">Scheduling Manager</h2>
              <p className="text-sm text-[#718096]">Edit lead info & call scheduler</p>
            </div>
            <button aria-label="Close" data-raydar-back-close
              onClick={onClose}
              className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#718096]" />
            </button>
          </div>

          {/* Form */}
          <div className="p-6 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                required
              />
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Street Address *
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                required
              />
            </div>

            {/* City, State, Zip */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  City *
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                  State *
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                  maxLength={2}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                ZIP Code *
              </label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                required
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                placeholder="(555) 123-4567"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                placeholder="customer@email.com"
              />
            </div>

            {/* Estimated Bill */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Estimated Monthly Bill ($)
              </label>
              <input
                type="number"
                value={formData.estimatedBill}
                onChange={(e) => setFormData({ ...formData, estimatedBill: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                placeholder="150"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A]"
                rows={3}
                placeholder="Any additional notes..."
              />
            </div>

            {/* Solar Info (Read-only) */}
            {lead.solarScore && (
              <div className="p-4 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                <div className="text-sm font-semibold text-[#2D3748] mb-2">Solar Information</div>
                <div className="text-sm text-[#718096] space-y-1">
                  <div>Solar Score: <span className="font-semibold text-[#FF5F5A]">{lead.solarScore}/100</span></div>
                  {lead.solarSunshineHours && <div>Sun Hours/Year: {Math.round(lead.solarSunshineHours).toLocaleString()}</div>}
                  {lead.hasSouthFacingRoof !== undefined && <div>South-Facing Roof: {lead.hasSouthFacingRoof ? 'Yes ✅' : 'No'}</div>}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-6 py-4 space-y-3">
            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full px-4 py-3 bg-[#4299E1] hover:bg-[#3182CE] text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>

            {/* Step 1: Send Info */}
            {!infoSent && (cooldownUntil > now || sendNotice) && (
              <p role="status" className="text-sm text-center text-[#4A5568]">
                {cooldownUntil > now
                  ? `Too many requests. You can send again in ${Math.max(1, Math.ceil((cooldownUntil - now) / 1000))} seconds.`
                  : sendNotice}
              </p>
            )}
            {!infoSent ? (
              <button
                onClick={handleSendInfo}
                disabled={isSending || blockedForAccount || cooldownUntil > now}
                className="w-full px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-5 h-5" />
                {isSending ? 'Sending...' : 'Send Info to Scheduling Manager'}
              </button>
            ) : (
              <>
                {/* Success Message */}
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-center">
                  <div className="text-green-800 font-semibold flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Info Sent Successfully!
                  </div>
                  <div className="text-sm text-green-600 mt-1">Scheduling manager has been notified</div>
                </div>

                {/* Step 2: Call link (only shows after send).
                    Native tel: keeps the iOS user gesture; do not await before navigation. */}
                <a
                  href={schedulingManagerTel}
                  onClick={() => {
                    setTimeout(() => {
                      onClose();
                    }, 500);
                  }}
                  className="w-full px-4 py-3 bg-[#48BB78] hover:bg-[#38A169] text-white rounded-lg font-semibold no-underline transition-colors flex items-center justify-center gap-2"
                >
                  <Phone className="w-5 h-5" />
                  Call Scheduling Manager
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
