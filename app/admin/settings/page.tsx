'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Bell, MessageSquare, Send } from 'lucide-react';
import { canManageUsers } from '@/app/types';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { getAdminSettingsAsync, saveAdminSettingsAsync, AdminSettings } from '@/app/utils/adminSettings';

export default function AdminSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AdminSettings>({
    schedulingManagerPhone: '(716) 272-9889',
    notificationWebhook: '',
    notificationType: 'discord',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const user = await getCurrentAuthUser();
        
        if (!user) {
          console.error('No user found, redirecting to login');
          router.push('/login');
          return;
        }
        
        if (!canManageUsers(user.role)) {
          console.error('User not authorized for settings management');
          router.push('/');
          return;
        }

        // Load settings from Firestore (with localStorage fallback)
        const saved = await getAdminSettingsAsync();
        if (saved) {
          setSettings(saved);
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Settings page load error:', error);
        setIsLoading(false);
        router.push('/');
      }
    }
    loadData();
  }, [router]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveAdminSettingsAsync(settings);
      alert('Settings saved successfully! ✅\n\nNow synced across all devices.');
    } catch (error: any) {
      alert(`Error saving settings: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!settings.notificationWebhook) {
      alert('Please enter a webhook URL first');
      return;
    }

    setTestResult('Sending...');

    try {
      const payload = settings.notificationType === 'discord'
        ? { content: '🧪 Test notification from Raydar - Scheduling Manager integration working!' }
        : settings.notificationType === 'googlechat'
        ? { text: '🧪 Test notification from Raydar - Scheduling Manager integration working!' }
        : settings.notificationType === 'slack'
        ? { text: '🧪 Test notification from Raydar - Scheduling Manager integration working!' }
        : { message: '🧪 Test notification from Raydar - Scheduling Manager integration working!' };

      const response = await fetch(settings.notificationWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setTestResult('✅ Success! Check your messaging app.');
      } else {
        setTestResult(`❌ Failed: ${response.status} ${response.statusText}`);
      }
    } catch (err: any) {
      setTestResult(`❌ Error: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F7FAFC]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-[#718096]">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-[#718096] hover:text-[#2D3748] mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Admin
          </button>
          <h1 className="text-3xl font-bold text-[#2D3748]">Admin Settings</h1>
          <p className="text-[#718096] mt-2">Configure system-wide settings and integrations (synced across all devices)</p>
        </div>

        {/* Scheduling Manager Settings */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#FF5F5A]/10 rounded-lg flex items-center justify-center">
              <Bell className="w-5 h-5 text-[#FF5F5A]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#2D3748]">Scheduling Manager</h2>
              <p className="text-sm text-[#718096]">Phone number and notification settings</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={settings.schedulingManagerPhone}
                onChange={(e) => setSettings({ ...settings, schedulingManagerPhone: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] text-[#2D3748]"
                placeholder="(716) 272-9889"
              />
              <p className="text-xs text-[#718096] mt-1">
                This number will be dialed when setters click "Call Scheduling Manager"
              </p>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#4299E1]/10 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-[#4299E1]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#2D3748]">Notification Webhook</h2>
              <p className="text-sm text-[#718096]">Send alerts when setters request scheduling manager</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Notification Platform
              </label>
              <select
                value={settings.notificationType}
                onChange={(e) => setSettings({ ...settings, notificationType: e.target.value as any })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] text-[#2D3748]"
              >
                <option value="discord">Discord</option>
                <option value="googlechat">Google Chat</option>
                <option value="slack">Slack</option>
                <option value="webhook">Custom Webhook</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Webhook URL
              </label>
              <input
                type="url"
                value={settings.notificationWebhook}
                onChange={(e) => setSettings({ ...settings, notificationWebhook: e.target.value })}
                className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] text-[#2D3748] font-mono text-sm"
                placeholder="https://discord.com/api/webhooks/..."
              />
              <p className="text-xs text-[#718096] mt-1">
                Get this from your messaging app's webhook settings
              </p>
            </div>

            {/* Test Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                className="px-4 py-2 bg-[#4299E1] hover:bg-[#3182CE] text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Send Test Notification
              </button>
              {testResult && (
                <span className="text-sm text-[#718096]">{testResult}</span>
              )}
            </div>
          </div>

          {/* Setup Instructions */}
          <div className="mt-6 p-4 bg-[#F7FAFC] rounded-lg border border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-2">Setup Instructions</h3>
            <div className="space-y-2 text-xs text-[#718096]">
              {settings.notificationType === 'discord' && (
                <>
                  <p><strong>Discord:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Go to your Discord server settings</li>
                    <li>Navigate to Integrations → Webhooks</li>
                    <li>Click "New Webhook"</li>
                    <li>Name it "Raydar Scheduling Manager"</li>
                    <li>Copy the webhook URL and paste it above</li>
                  </ol>
                </>
              )}
              {settings.notificationType === 'googlechat' && (
                <>
                  <p><strong>Google Chat:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Open Google Chat and go to the desired space</li>
                    <li>Click space name → Manage webhooks</li>
                    <li>Click "Add webhook"</li>
                    <li>Name it "Raydar Scheduling Manager"</li>
                    <li>Copy the webhook URL and paste it above</li>
                  </ol>
                </>
              )}
              {settings.notificationType === 'slack' && (
                <>
                  <p><strong>Slack:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Go to api.slack.com/apps</li>
                    <li>Create new app → From scratch</li>
                    <li>Enable "Incoming Webhooks"</li>
                    <li>Add New Webhook to Workspace</li>
                    <li>Copy the webhook URL and paste it above</li>
                  </ol>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-semibold transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
