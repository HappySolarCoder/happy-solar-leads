'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { AlertCircle, Eye, EyeOff, Lock } from 'lucide-react';
import { auth, db } from '@/app/utils/firebase';
import { signOut } from '@/app/utils/auth';
import { validatePasswordChange } from '@/app/utils/passwordChange';

export default function ChangePasswordClient({ allowForcedPreview }: { allowForcedPreview: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'ready'>(allowForcedPreview ? 'ready' : 'loading');
  const [forced, setForced] = useState(allowForcedPreview);
  const [signedIn, setSignedIn] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordAlreadyUpdated, setPasswordAlreadyUpdated] = useState(false);

  useEffect(() => {
    if (!auth || !db) {
      if (allowForcedPreview) {
        setForced(true);
        setSignedIn(false);
        setPhase('ready');
        return;
      }
      router.replace('/login?next=/change-password');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setSignedIn(false);
        if (allowForcedPreview) {
          setForced(true);
          setPhase('ready');
          return;
        }
        router.replace('/login?next=/change-password');
        return;
      }

      setSignedIn(true);
      try {
        const snap = await getUserFlag(firebaseUser.uid);
        setForced(snap);
      } catch (err) {
        console.error('Change password profile read failed:', errorCode(err) || 'unknown');
        setForced(false);
      }
      setPhase('ready');
    });

    return unsubscribe;
  }, [allowForcedPreview, router]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!passwordAlreadyUpdated) {
      const validationError = validatePasswordChange({ currentPassword, newPassword, confirmPassword });
      if (validationError) {
        setError(validationError);
        return;
      }
    } else if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }

    if (!auth?.currentUser || !db || !signedIn) {
      setError(allowForcedPreview
        ? 'Preview only. Sign in on the real account to save a password.'
        : 'Sign in again to change your password.');
      return;
    }

    const email = auth.currentUser.email;
    if (!email) {
      setError('This account has no email address. Contact an admin.');
      return;
    }

    setSaving(true);
    let updated = passwordAlreadyUpdated;
    try {
      const credential = EmailAuthProvider.credential(email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      if (!updated) {
        await updatePassword(auth.currentUser, newPassword);
        updated = true;
        setPasswordAlreadyUpdated(true);
      }
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { mustChangePassword: false });
      router.replace('/');
    } catch (err) {
      console.error('Change password failed:', errorCode(err) || 'unknown');
      setError(messageForAuthError(err, updated));
    } finally {
      setSaving(false);
    }
  };

  if (phase === 'loading') {
    return (
      <div className="min-h-dvh bg-[#F7FAFC] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F7FAFC] flex flex-col" data-testid="change-password-screen">
      <main className="flex-1 w-full max-w-md mx-auto px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="text-center mb-6">
          <img src="/raydar-horizontal.png" alt="Raydar" className="h-10 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[#2D3748]">
            {forced ? 'Set a new password' : 'Change password'}
          </h1>
          <p className="text-[#718096] mt-2 text-base">
            {forced
              ? 'Choose a new password before you use Raydar. This replaces the temporary one from onboarding.'
              : 'Update the password you use to sign in.'}
          </p>
        </div>

        {forced && (
          <div
            className="mb-4 rounded-xl border border-[#FBD38D] bg-[#FFFAF0] px-4 py-3 text-sm text-[#975A16]"
            data-testid="change-password-forced"
          >
            You need to change your password before the rest of the app will open.
          </div>
        )}

        <form id="change-password-form" onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 space-y-5">
          <PasswordField
            id="current-password"
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            shown={showPasswords}
            testId="change-password-current"
          />

          {!passwordAlreadyUpdated && (
            <>
              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                shown={showPasswords}
                testId="change-password-new"
                hint="At least 8 characters."
              />
              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                shown={showPasswords}
                testId="change-password-confirm"
              />
            </>
          )}

          {passwordAlreadyUpdated && (
            <p className="text-sm text-[#2D3748]">
              Your password was saved. Enter it above again to finish unlocking Raydar.
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowPasswords((value) => !value)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#718096] min-h-11"
          >
            {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showPasswords ? 'Hide passwords' : 'Show passwords'}
          </button>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3" role="alert" data-testid="change-password-error">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            data-testid="change-password-submit"
            className="w-full min-h-12 bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save password'}
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-12 border-2 border-[#E2E8F0] text-[#2D3748] font-semibold rounded-lg hover:bg-[#F7FAFC] transition-colors"
          >
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  shown,
  testId,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  shown: boolean;
  testId: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[#2D3748] mb-2">
        {label}
      </label>
      <div className="relative">
        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
        <input
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-testid={testId}
          className="w-full min-h-12 pl-12 pr-4 text-base border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
        />
      </div>
      {hint && <p className="text-xs text-[#718096] mt-1">{hint}</p>}
    </div>
  );
}

async function getUserFlag(uid: string): Promise<boolean> {
  if (!db) return false;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() && snap.data()?.mustChangePassword === true;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
}

function messageForAuthError(error: unknown, passwordAlreadyUpdated: boolean): string {
  const code = errorCode(error);
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Current password is incorrect.';
  }
  if (code === 'auth/weak-password') {
    return 'New password is too weak. Use at least 8 characters.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Sign in again, then change your password.';
  }
  if (passwordAlreadyUpdated) {
    return 'Your password was changed, but Raydar could not finish unlocking the app. Tap Save again.';
  }
  return 'Could not change your password. Try again.';
}
