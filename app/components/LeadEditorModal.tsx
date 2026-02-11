'use client';

import { useState } from 'react';
import { X, Phone, Save, Send } from 'lucide-react';
import { Lead } from '@/app/types';
import { saveLeadAsync, getCurrentUserAsync } from '@/app/utils/storage';

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
  const [isCalling, setIsCalling] = useState(false);

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

  const handleCallSchedulingManager = async () => {
    setIsCalling(true);

    try {
      // 1. Get current user
      const currentUser = await getCurrentUserAsync();
      
      // 2. Get admin settings
      const settingsStr = localStorage.getItem('raydar_admin_settings');
      const settings = settingsStr ? JSON.parse(settingsStr) : null;

      console.log('Settings loaded:', settings ? 'yes' : 'no');
      console.log('Webhook URL:', settings?.notificationWebhook ? 'present' : 'missing');

      // 3. Send webhook notification FIRST (before opening dialer)
      if (settings?.notificationWebhook) {
        // Build solar data section
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
👤 **Sent by:** ${currentUser?.name || 'Unknown Setter'}

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
        console.log('Payload type:', settings.notificationType);

        // Send webhook and WAIT for response
        try {
          const response = await fetch(settings.notificationWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            console.log('✅ Webhook sent successfully');
          } else {
            console.error('❌ Webhook failed:', response.status, response.statusText);
            alert('Warning: Notification may not have been sent. Call anyway?');
          }
        } catch (err: any) {
          console.error('❌ Webhook error:', err);
          alert(`Warning: Could not send notification (${err.message}). Call anyway?`);
        }
      } else {
        console.warn('⚠️ No webhook configured - skipping notification');
      }

      // 4. THEN open phone dialer
      const phoneNumber = settings?.schedulingManagerPhone || '(716) 272-9889';
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      console.log('Opening dialer:', cleanPhone);
      window.location.href = `tel:${cleanPhone}`;

      // Close modal after short delay
      setTimeout(() => {
        onClose();
      }, 1000);
    } finally {
      setIsCalling(false);
    }
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
          <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-6 py-4 flex gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 px-4 py-3 bg-[#4299E1] hover:bg-[#3182CE] text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            
            <button
              onClick={handleCallSchedulingManager}
              disabled={isCalling}
              className="flex-1 px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Phone className="w-5 h-5" />
              {isCalling ? 'Calling...' : 'Call Scheduling Manager'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
