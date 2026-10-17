'use client';

import { useState, useEffect } from 'react';
import { X, Phone, Save, Send } from 'lucide-react';
import { Lead, User } from '@/app/types';
import { saveLeadAsync, getCurrentUserAsync, invalidateLeadsCache } from '@/app/utils/storage';
import { getAdminSettingsAsync, SchedulingAccessError } from '@/app/utils/adminSettings';
import { sendSchedulingWebhook } from '@/app/utils/schedulingWebhook';
import {
  beginSchedulingSend,
  SCHEDULING_UNAVAILABLE_MESSAGE,
  schedulingAction,
} from '@/app/utils/schedulingAccess';
import { auth } from '@/app/utils/firebase';
import {
  FALLBACK_SCHEDULING_MANAGER_PHONE,
  schedulingManagerTelDigits,
} from '@/app/utils/schedulingManagerTel';

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
  const [schedulingUnavailable, setSchedulingUnavailable] = useState(false);
  // Cached before the call tap. Reading this during the click must not await.
  const [schedulingManagerPhone, setSchedulingManagerPhone] = useState(FALLBACK_SCHEDULING_MANAGER_PHONE);

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
        const action = schedulingAction(settings ? { status: 'ready', settings } : { status: 'missing' });
        if (!cancelled && action.phone) setSchedulingManagerPhone(action.phone);
      } catch (error) {
        if (!cancelled && error instanceof SchedulingAccessError) setSchedulingUnavailable(true);
      }
    }

    loadUser();
    loadSchedulingManagerPhone();

    return () => {
      cancelled = true;
    };
  }, [signedInRep]);

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
    if (schedulingUnavailable) return;
    setIsSending(true);

    try {
      // 0. Validate required fields before doing anything
      const missing: string[] = [];
      const isBlank = (v: unknown) => !String(v ?? '').trim();

      if (isBlank(formData.name)) missing.push('Name');
      if (isBlank(formData.address)) missing.push('Street Address');
      if (isBlank(formData.city)) missing.push('City');
      if (isBlank(formData.state)) missing.push('State');
      if (isBlank(formData.zip)) missing.push('Zip');
      // Strongly recommended: phone is required for scheduling manager to call
      if (isBlank(formData.phone)) missing.push('Phone');

      if (missing.length > 0) {
        alert(`Missing required fields:\n\n- ${missing.join('\n- ')}\n\nPlease fill these out before sending to the Scheduling Manager.`);
        return;
      }

      // Basic format sanity checks (non-blocking beyond alerts)
      const zipClean = String(formData.zip).trim();
      if (!/^\d{5}(-\d{4})?$/.test(zipClean)) {
        alert('Zip code looks invalid. Please enter a 5-digit ZIP (or ZIP+4) before sending.');
        return;
      }

      // 1. Get current user (fallback if state not loaded yet)
      const user = signedInRep || currentUser || await getCurrentUserAsync();
      if (mobileMode && (!user || auth?.currentUser?.uid !== user.id)) throw Error('Sign in again before sending this request.');
      

      // 2. Get admin settings from Firestore (synced across devices).
      // A denied read disables scheduling. It must not use a stored or hardcoded webhook.
      const settings = await getAdminSettingsAsync();
      const action = schedulingAction(settings ? { status: 'ready', settings } : { status: 'missing' });
      const decision = beginSchedulingSend(schedulingUnavailable, action);
      if (decision === 'disabled') {
        setSchedulingUnavailable(true);
        return;
      }
      if (decision === 'unconfigured') {
        alert(`Webhook not configured!\n\nGo to Admin → Settings and configure Discord webhook.\n\n(Settings are now synced via Firestore - works on all devices!)`);
        return;
      }

      // A new imported home becomes a visit only on an explicit Save/Send action.
      // Persist before the webhook so the scheduling request has a real lead.
      if (saveLeadPatch) await saveLeadPatch({ name: formData.name, address: formData.address, city: formData.city, state: formData.state, zip: formData.zip, phone: formData.phone || '', email: formData.email || '', notes: formData.notes || '', ...(formData.estimatedBill ? { estimatedBill: Number(formData.estimatedBill) } : {}) });
      await beforeSend?.();

      // 3. Build and send webhook notification
      let solarSection = '';
      if (lead.solarScore) {
        solarSection = `\n**☀️ Solar Data:**
- Solar Score: ${lead.solarScore}/100
- Sun Hours/Year: ${lead.solarSunshineHours ? Math.round(lead.solarSunshineHours).toLocaleString() : 'N/A'}
- Max Panels: ${lead.solarMaxPanels || 'N/A'}
- South-Facing Roof: ${lead.hasSouthFacingRoof !== undefined ? (lead.hasSouthFacingRoof ? 'Yes ✅' : 'No ❌') : 'N/A'}`;
      }


      const leadInfo = `
📞 **Scheduling Manager Request**
👤 **Sent by:** ${user?.name || 'Unknown Setter'}

**Lead Details:**
👤 Name: ${formData.name}
📍 Address: ${formData.address}, ${formData.city}, ${formData.state} ${formData.zip}
📞 Phone: ${formData.phone || 'N/A'}
📧 Email: ${formData.email || 'N/A'}
💰 Est. Bill: ${formData.estimatedBill ? `$${formData.estimatedBill}/mo` : 'N/A'}${solarSection}

📝 Notes: ${formData.notes || 'None'}${fieldContext ? `\nField context: ${fieldContext}` : ''}

🎯 **Action Required:** Call customer to schedule appointment
      `.trim();

      const payload: Record<string, string> = settings?.notificationType === 'discord'
        ? { content: leadInfo }
        : settings?.notificationType === 'googlechat'
        ? { text: leadInfo }
        : settings?.notificationType === 'slack'
        ? { text: leadInfo }
        : { message: leadInfo };


      // Send webhook. beginSchedulingSend already refused a missing or denied URL.
      const response = await sendSchedulingWebhook(action.webhook as string, payload);

      if (response.ok) {
        setInfoSent(true);
        void onInfoSent?.().catch(() => {});
      } else {
        console.error('❌ Webhook failed:', response.status, response.statusText);
        alert(`Failed to send notification: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      if (err instanceof SchedulingAccessError) {
        setSchedulingUnavailable(true);
        return;
      }
      console.error('❌ Webhook error:', err);
      alert(`Error sending notification: ${(err as Error).message}`);
    } finally {
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
            {schedulingUnavailable && (
              <p role="status" className="text-sm text-center text-[#4A5568]">{SCHEDULING_UNAVAILABLE_MESSAGE}</p>
            )}
            {!infoSent ? (
              <button
                onClick={handleSendInfo}
                disabled={isSending || schedulingUnavailable}
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
