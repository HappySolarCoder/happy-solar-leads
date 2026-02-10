'use client';

import { useState } from 'react';
import { User, Check, Users, MapPin, Loader2 } from 'lucide-react';
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
  const [homeAddress, setHomeAddress] = useState('');
  const [homeLat, setHomeLat] = useState<number | undefined>();
  const [homeLng, setHomeLng] = useState<number | undefined>();
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState('');
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLORS[0]);
  const [step, setStep] = useState<'welcome' | 'form'>('welcome');

  if (!isOpen) return null;

  // Geocode the home address
  const geocodeHomeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!address.trim()) return null;
    
    setIsGeocoding(true);
    setGeocodeError('');
    
    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          address,
          apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY || '',
        }),
      });

      const data = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return { lat: location.lat, lng: location.lng };
      }
      
      setGeocodeError('Address not found. Please check and try again.');
      return null;
    } catch (error) {
      setGeocodeError('Failed to verify address. You can continue without it.');
      return null;
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !email.trim()) return;

    // Geocode home address if provided
    let finalLat = homeLat;
    let finalLng = homeLng;
    
    if (homeAddress.trim() && !homeLat) {
      const coords = await geocodeHomeAddress(homeAddress);
      if (coords) {
        finalLat = coords.lat;
        finalLng = coords.lng;
      }
    }

    const newUser: UserType = {
      id: generateId(),
      name: name.trim(),
      email: email.trim(),
      color: selectedColor,
      createdAt: new Date(),
      // Auto-assignment fields
      homeAddress: homeAddress.trim() || undefined,
      homeLat: finalLat,
      homeLng: finalLng,
      assignedLeadCount: 0,
      isActive: true,
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

                {/* Home Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      Home Address
                      <span className="text-gray-400 font-normal">(for lead assignment)</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    value={homeAddress}
                    onChange={(e) => {
                      setHomeAddress(e.target.value);
                      setHomeLat(undefined);
                      setHomeLng(undefined);
                      setGeocodeError('');
                    }}
                    onBlur={async () => {
                      if (homeAddress.trim() && !homeLat) {
                        const coords = await geocodeHomeAddress(homeAddress);
                        if (coords) {
                          setHomeLat(coords.lat);
                          setHomeLng(coords.lng);
                        }
                      }
                    }}
                    placeholder="123 Main St, Phoenix, AZ 85001"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {isGeocoding && (
                    <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Verifying address...
                    </p>
                  )}
                  {geocodeError && (
                    <p className="text-xs text-orange-500 mt-1">{geocodeError}</p>
                  )}
                  {homeLat && homeLng && (
                    <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Address verified!
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Leads will be auto-assigned based on distance from your home.
                  </p>
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
