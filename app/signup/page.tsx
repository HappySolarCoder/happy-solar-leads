'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/app/utils/firebase';
import { ArrowRight, Mail, Lock, User as UserIcon, AlertCircle, Shield } from 'lucide-react';

type UserRole = 'setter' | 'closer' | 'manager' | 'admin';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('setter');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (!auth || !db) {
        throw new Error('Firebase not initialized');
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setIsLoading(false);
        return;
      }

      // Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Save user data to Firestore
      await setDoc(doc(db, 'users', uid), {
        id: uid,
        name,
        email,
        role,
        createdAt: new Date(),
        status: 'active',
        isActive: true, // For auto-assignment and admin panel
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`, // Random color for map pins
      });

      // Redirect to main app
      router.push('/');
    } catch (err: any) {
      console.error('Signup error:', err);
      
      if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak');
      } else {
        setError('Account creation failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const roleDescriptions = {
    setter: 'Door-to-door sales representative',
    closer: 'Close deals and track appointments',
    manager: 'Manage team and assign leads',
    admin: 'Full system access and configuration',
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/raydar-horizontal.png"
            alt="Raydar"
            className="h-12 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-[#2D3748]">Create Account</h1>
          <p className="text-[#718096] mt-2">Join your team on Raydar</p>
        </div>

        {/* Signup Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8">
          <form onSubmit={handleSignup} className="space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Full Name
              </label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#718096]" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Smith"
                  required
                  className="w-full pl-12 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
                />
              </div>
            </div>

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
                  minLength={6}
                  className="w-full pl-12 pr-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
                />
              </div>
              <p className="text-xs text-[#718096] mt-1">Minimum 6 characters</p>
            </div>

            {/* Role Selection */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Your Role
              </label>
              <div className="space-y-2">
                {(['setter', 'closer', 'manager', 'admin'] as UserRole[]).map((roleOption) => (
                  <label
                    key={roleOption}
                    className={`flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      role === roleOption
                        ? 'border-[#FF5F5A] bg-[#FF5F5A]/5'
                        : 'border-[#E2E8F0] hover:border-[#FF5F5A]/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={roleOption}
                      checked={role === roleOption}
                      onChange={(e) => setRole(e.target.value as UserRole)}
                      className="w-5 h-5 text-[#FF5F5A] focus:ring-[#FF5F5A]"
                    />
                    <div className="flex-1">
                      <div className="font-semibold text-[#2D3748] capitalize">{roleOption}</div>
                      <div className="text-sm text-[#718096]">{roleDescriptions[roleOption]}</div>
                    </div>
                    {roleOption === 'admin' && (
                      <Shield className="w-5 h-5 text-[#FF5F5A]" />
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Create Account Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  Create Account
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
              <span className="px-4 bg-white text-[#718096]">Already have an account?</span>
            </div>
          </div>

          {/* Login Button */}
          <button
            onClick={() => router.push('/login')}
            className="w-full border-2 border-[#E2E8F0] text-[#2D3748] font-semibold py-3 rounded-lg hover:bg-[#F7FAFC] transition-colors"
          >
            Sign In
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
