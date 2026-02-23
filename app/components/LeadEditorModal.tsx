'use client';

import { useState, useEffect } from 'react';
import { X, Phone, Save, Send } from 'lucide-react';
import { Lead, User } from '@/app/types';
import { saveLeadAsync, getCurrentUserAsync } from '@/app/utils/storage';
import { getAdminSettingsAsync } from '@/app/utils/adminSettings';

interface LeadEditorModalProps {
  lead: Lead;
  onClose: () => void;
  onSave: () => void;
}

export default function LeadEditorModal({ lead, onClose, onSave }: LeadEditorModalProps) {
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

  // Load current user when component mounts
  useEffect(() => {
    async function loadUser() {
      const user = await getCurrentUserAsync();
      setCurrentUser(user);
    }
    loadUser();
  }, []);

  const handleSave = async () => {
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

      await saveLeadAsync(updatedLead);
      onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInfo = async () => {
    setIsSending(true);

    try {
      // 1. Get current user (fallback if state not loaded yet)
      const user = currentUser || await getCurrentUserAsync();
      
      console.log('=== USER DEBUG ===');
      console.log('Current user from state:', currentUser);
      console.log('User for message:', user);
      console.log('User name:', user?.name);

      // 2. Get admin settings from Firestore (synced across devices)
      const settings = await getAdminSettingsAsync();

      console.log('=== SETTINGS DEBUG ===');
      console.log('Settings loaded from Firestore:', settings);
      console.log('Webhook URL:', settings?.notificationWebhook);

      if (!settings?.notificationWebhook) {
        console.error('Settings check failed:', { settings });
        alert(`Webhook not configured!\n\nGo to Admin → Settings and configure Discord webhook.\n\n(Settings are now synced via Firestore - works on all devices!)`);
        return;
      }

      // 3. Build and send webhook notification
      let solarSection = '';
      if (lead.solarScore) {
        solarSection = `\n**☀️ Solar Data:**
- Solar Score: ${lead.solarScore}/100
- Sun Hours/Year: ${lead.solarSunshineHours ? Math.round(lead.solarSunshineHours).toLocaleString() : 'N/A'}
- Max Panels: ${lead.solarMaxPanels || 'N/A'}
- South-Facing Roof: ${lead.hasSouthFacingRoof !== undefined ? (lead.hasSouthFacingRoof ? 'Yes ✅' : 'No ❌') : 'N/A'}`;
      }

      console.log('=== FORM DATA DEBUG ===');
      console.log('Form data:', formData);
      console.log('Lead name:', formData.name);

      const leadInfo = `
📞 **Scheduling Manager Request**
👤 **Sent by:** ${user?.name || 'Unknown Setter'}

**Lead Details:**
👤 Name: ${formData.name}
📍 Address: ${formData.address}, ${formData.city}, ${formData.state} ${formData.zip}
📞 Phone: ${formData.phone || 'N/A'}
📧 Email: ${formData.email || 'N/A'}
💰 Est. Bill: ${formData.estimatedBill ? `$${formData.estimatedBill}/mo` : 'N/A'}${solarSection}

📝 Notes: ${formData.notes || 'None'}

🎯 **Action Required:** Call customer to schedule appointment
      `.trim();

      const payload = settings.notificationType === 'discord'
        ? { content: leadInfo }
        : settings.notificationType === 'googlechat'
        ? { text: leadInfo }
        : settings.notificationType === 'slack'
        ? { text: leadInfo }
        : { message: leadInfo };

      console.log('Sending webhook to:', settings.notificationWebhook);

      // Send webhook
      const response = await fetch(settings.notificationWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log('✅ Webhook sent successfully');
        setInfoSent(true);
      } else {
        console.error('❌ Webhook failed:', response.status, response.statusText);
        alert(`Failed to send notification: ${response.status} ${response.statusText}`);
      }
    } catch (err: any) {
      console.error('❌ Webhook error:', err);
      alert(`Error sending notification: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleCall = async () => {
    const settings = await getAdminSettingsAsync();
    
    const phoneNumber = settings?.schedulingManagerPhone || '(716) 272-9889';
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    console.log('Opening dialer:', cleanPhone);
    window.location.href = `tel:${cleanPhone}`;

    // Close modal after short delay
    setTimeout(() => {
      onClose();
    }, 500);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
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
            <button
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
            {!infoSent ? (
              <button
                onClick={handleSendInfo}
                disabled={isSending}
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

                {/* Step 2: Call Button (only shows after send) */}
                <button
                  onClick={handleCall}
                  className="w-full px-4 py-3 bg-[#48BB78] hover:bg-[#38A169] text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <Phone className="w-5 h-5" />
                  Call Scheduling Manager
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
