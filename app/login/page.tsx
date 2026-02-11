'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/app/utils/firebase';
import { ArrowRight, Mail, Lock, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (!auth) {
        throw new Error('Firebase not initialized');
      }

      await signInWithEmailAndPassword(auth, email, password);
      
      // Redirect to main app
      router.push('/');
    } catch (err: any) {
      console.error('Login error:', err);
      
      if (err.code === 'auth/invalid-credential') {
        setError('Invalid email or password');
      } else if (err.code === 'auth/user-not-found') {
        setError('No account found with this email');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/raydar-horizontal.png"
            alt="Raydar"
            className="h-12 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-[#2D3748]">Welcome Back</h1>
          <p className="text-[#718096] mt-2">Sign in to your account</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="email"
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
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="password"
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
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
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

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#E2E8F0]" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-[#718096]">New to Raydar?</span>
            </div>
          </div>

          {/* Create Account Button */}
          <button
            onClick={() => router.push('/signup')}
            className="w-full border-2 border-[#E2E8F0] text-[#2D3748] font-semibold py-3 rounded-lg hover:bg-[#F7FAFC] transition-colors"
          >
            Create Account
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#718096] mt-8">
          &copy; 2026 Raydar. Door-knocking made simple.
        </p>
      </div>
    </div>
  );
}
