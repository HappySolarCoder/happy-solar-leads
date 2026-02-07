'use client';

import { useState } from 'react';
import { User, Check, Users } from 'lucide-react';
import { DEFAULT_COLORS } from '@/app/types';
import { getUsers, saveUsers, saveCurrentUser, generateId } from '@/app/utils/storage';
import type { User as UserType } from '@/app/types';

interface UserOnboardingProps {
  isOpen: boolean;
  onComplete: (user: UserType) => void;
}

export default function UserOnboarding({ isOpen, onComplete }: UserOnboardingProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLORS[0]);
  const [step, setStep] = useState<'welcome' | 'form'>('welcome');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !email.trim()) return;

    const newUser: UserType = {
      id: generateId(),
      name: name.trim(),
      email: email.trim(),
      color: selectedColor,
      createdAt: new Date(),
    };

    // Save to users list
    const existingUsers = getUsers();
    saveUsers([...existingUsers, newUser]);
    
    // Set as current user
    saveCurrentUser(newUser);
    
    onComplete(newUser);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {step === 'welcome' ? (
          <>
            <div className="p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                <Users className="w-8 h-8 text-blue-500" />
              </div>
              
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Welcome to Happy Solar Leads
              </h2>
              <p className="text-gray-500 mb-6">
                Let's get you set up so you can start knocking.
              </p>

              <div className="space-y-3 text-left bg-gray-50 rounded-lg p-4 mb-6">
                <p className="text-sm text-gray-600">
                  With this app, you can:
                </p>
                <ul className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    View leads on an interactive map
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    Claim leads to avoid duplicates
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    Track your dispositions
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    Upload your own lead lists
                  </li>
                </ul>
              </div>
            </div>

            <div className="px-8 pb-8">
              <button
                onClick={() => setStep('form')}
                className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
              >
                Get Started
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Tell us about yourself
              </h2>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@company.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Color Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Your Map Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DEFAULT_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setSelectedColor(color)}
                        className={`w-8 h-8 rounded-full transition-transform ${
                          selectedColor === color 
                            ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' 
                            : 'hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    This color will identify your claimed leads on the map.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
              <button
                type="button"
                onClick={() => setStep('welcome')}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={!name.trim() || !email.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Knocking
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
