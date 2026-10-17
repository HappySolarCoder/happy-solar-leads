'use client';

import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchSignInMethodsForEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/app/utils/firebase';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { saveCurrentUser } from '@/app/utils/storage';
import { ArrowRight, Mail, Lock, AlertCircle } from 'lucide-react';
import { MOBILE_BUILD_LABEL, startupEvent } from '@/app/mobile/_lib/startupDiagnostics';
import {
  ACCOUNT_DELETION_STORAGE_KEY,
  PRIVACY_POLICY_URL,
  missingAccountMessage,
} from '@/app/mobile/_lib/accountPolicy';
import { withDeadline } from '@/app/utils/withDeadline';

const nativeBuild = process.env.NEXT_PUBLIC_NATIVE_BUILD === '1';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const pendingLogin = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try {
      const message = sessionStorage.getItem(ACCOUNT_DELETION_STORAGE_KEY);
      if (!message) return;
      sessionStorage.removeItem(ACCOUNT_DELETION_STORAGE_KEY);
      setNotice(message);
    } catch {
      /* Sign-in still works if session storage is unavailable. */
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingLogin.current) return;
    pendingLogin.current = true;
    setError('');
    setIsLoading(true);

    try {
      if (!auth) {
        throw new Error('Firebase not initialized');
      }

      const startedAt = Date.now();
      if (nativeBuild) startupEvent('login-start');
      const signIn = signInWithEmailAndPassword(auth, email.trim(), password);
      if (nativeBuild) {
        // One sign-in request, including after a UI timeout. If the network
        // eventually succeeds, open Today while this screen is still mounted.
        const completion = signIn.then(() => {
          startupEvent('login-ready', startedAt);
          if (mounted.current) router.replace('/mobile');
        }).finally(() => {
          pendingLogin.current = false;
          if (mounted.current) setIsLoading(false);
        });
        await withDeadline(completion, 15_000,
          'Sign-in is taking longer than expected. Waiting for the connection. You can reload the app to retry.');
        // MobileDataProvider reads the profile once and checks approval/role.
        // Do not block login on a duplicate Firestore profile read here.
        return;
      }
      await signIn;
      
      // Get user from Firestore and save to localStorage
      const user = await getCurrentAuthUser();
      if (user) {
        saveCurrentUser(user);
        console.log('User saved to localStorage:', user.name);
      }
      
      // Redirect to main app
      router.replace(Capacitor.isNativePlatform() ? '/mobile' : '/');
    } catch (err: any) {
      if (!mounted.current) return;
      if (err.code !== 'raydar/timeout') pendingLogin.current = false;
      if (nativeBuild) startupEvent('login-error', undefined, err);
      else console.error('Login error:', err);
      
      if (err.code === 'auth/user-disabled') {
        setError('This account is disabled. Contact an admin.');
      } else if (err.code === 'auth/user-not-found') {
        setError(missingAccountMessage());
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password.');
      } else if (err.code === 'auth/invalid-credential') {
        if (nativeBuild) {
          setError('Invalid email or password.');
          return;
        }
        // Firebase often collapses wrong-password + user-not-found into invalid-credential.
        // Probe sign-in methods to show a clearer message.
        try {
          const methods = auth ? await fetchSignInMethodsForEmail(auth, email) : [];
          if (!methods || methods.length === 0) {
            setError(missingAccountMessage());
          } else {
            setError('Incorrect password.');
          }
        } catch {
          setError('Invalid email or password.');
        }
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else if (err.code === 'raydar/timeout') {
        setError(err.message);
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      if (!nativeBuild || !pendingLogin.current) {
        pendingLogin.current = false;
        if (mounted.current) setIsLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src={process.env.NEXT_PUBLIC_NATIVE_BUILD === '1' ? '/brand/raydar-v5/raydar-primary-v5.svg' : '/raydar-horizontal.png'}
            alt="Raydar"
            className="h-12 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-[#2D3748]">Welcome Back</h1>
          <p className="text-[#718096] mt-2">Sign in to your account</p>
          {nativeBuild && <p className="text-xs text-[#587E98] mt-3">{MOBILE_BUILD_LABEL}</p>}
        </div>

        {notice && (
          <div role="status" className="mb-6 p-4 bg-[#EBF4FA] border border-[#C5D8E6] rounded-lg">
            <p className="text-sm text-[#2D3748]">{notice}</p>
          </div>
        )}

        {/* Login Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="block text-sm font-semibold text-[#2D3748] mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="email"
                  id="login-email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="w-full pl-12 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="login-password" className="block text-sm font-semibold text-[#2D3748] mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="password"
                  id="login-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-12 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
          {nativeBuild && error && <button type="button" onClick={() => window.location.reload()}
            className="w-full mt-4 text-sm text-[#476E88] underline">Reload app</button>}

          {process.env.NEXT_PUBLIC_NATIVE_BUILD !== '1' && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#E2E8F0]" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-[#718096]">New to Raydar?</span>
                </div>
              </div>
              <button
                onClick={() => router.push('/signup')}
                className="w-full border-2 border-[#E2E8F0] text-[#2D3748] font-semibold py-3 rounded-lg hover:bg-[#F7FAFC] transition-colors"
              >
                Create Account
              </button>
            </>
          )}
          {process.env.NEXT_PUBLIC_NATIVE_BUILD === '1' && (
            <>
              <p className="text-center text-sm text-[#718096] mt-6">
                Accounts are created by your manager.
              </p>
              <a
                href={PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-base font-semibold text-[#476E88] underline py-3 mt-2"
              >
                Privacy policy
              </a>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#718096] mt-8">
          &copy; 2026 Raydar. Door-knocking made simple.
        </p>
      </div>
    </div>
  );
}
