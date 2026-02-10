'use client';

import { useState, useEffect } from 'react';
import { Users, User, MapPin, ChevronDown, X, RefreshCw } from 'lucide-react';
import { getUsers, getCurrentUser, saveCurrentUser, saveUsers } from '@/app/utils/storage';
import { User as UserType } from '@/app/types';

interface UserSwitcherProps {
  onUserChange?: (user: UserType) => void;
}

export default function UserSwitcher({ onUserChange }: UserSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [allUsers, setAllUsers] = useState<UserType[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserHome, setNewUserHome] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
    setAllUsers(getUsers());
  }, []);

  const handleSwitchUser = (user: UserType) => {
    saveCurrentUser(user);
    setCurrentUser(user);
    setIsOpen(false);
    onUserChange?.(user);
  };

  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    
    setIsCreating(true);
    
    const newUser: UserType = {
      id: Date.now().toString(),
      email: newUserEmail,
      name: newUserName,
      role: 'setter',
      status: 'active',
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
      assignedLeadCount: 0,
      createdAt: new Date(),
      lastLogin: new Date(),
    };
    
    // Geocode home address if provided
    if (newUserHome.trim()) {
      try {
        console.log('[UserSwitcher] Geocoding home address:', newUserHome);
        const geoResp = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: newUserHome }),
        });
        
        if (!geoResp.ok) {
          console.error('[UserSwitcher] Geocode failed:', geoResp.status);
        }
        
        const geoData = await geoResp.json();
        console.log('[UserSwitcher] Geocode result:', geoData);
        
        if (geoData.lat && geoData.lng) {
          newUser.homeAddress = newUserHome;
          newUser.homeLat = parseFloat(geoData.lat);
          newUser.homeLng = parseFloat(geoData.lng);
          console.log('[UserSwitcher] Home coordinates set:', newUser.homeLat, newUser.homeLng);
        } else {
          console.warn('[UserSwitcher] Geocoding returned no coordinates');
        }
      } catch (e) {
        console.error('[UserSwitcher] Geocode error:', e);
      }
    }
    
    console.log('[UserSwitcher] Final user object:', {
      name: newUser.name,
      homeLat: newUser.homeLat,
      homeLng: newUser.homeLng
    });
    
    const users = getUsers();
    users.push(newUser);
    saveUsers(users);
    
    setAllUsers(users);
    
    // Switch to new user
    saveCurrentUser(newUser);
    setCurrentUser(newUser);
    
    setNewUserName('');
    setNewUserEmail('');
    setNewUserHome('');
    setShowAddUser(false);
    setIsCreating(false);
    setIsOpen(false);
  };

  if (!currentUser) return null;

  return (
    <div className="relative">
      {/* Current User Display */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <div 
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
          style={{ backgroundColor: currentUser.color }}
        >
          {currentUser.name.charAt(0).toUpperCase()}
        </div>
        <div className="hidden md:block text-left">
          <p className="text-sm font-medium text-gray-700">{currentUser.name}</p>
          <p className="text-xs text-gray-500 capitalize">{currentUser.role}</p>
        </div>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)} 
          />
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-20 overflow-hidden">
            
            {/* Header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Switch User</span>
              </div>
              <button
                onClick={() => setShowAddUser(!showAddUser)}
                className="p-1 hover:bg-gray-200 rounded"
              >
                {showAddUser ? <X className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            </div>

            {/* Add New User Form */}
            {showAddUser && (
              <div className="p-4 border-b border-gray-200 bg-blue-50">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Add New User</h4>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="Email Address"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="text"
                    value={newUserHome}
                    onChange={(e) => setNewUserHome(e.target.value)}
                    placeholder="Home Address (for routing)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleCreateUser}
                    disabled={!newUserName.trim() || !newUserEmail.trim() || isCreating}
                    className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {isCreating ? 'Creating...' : 'Create & Switch'}
                  </button>
                </div>
              </div>
            )}

            {/* User List */}
            <div className="max-h-64 overflow-y-auto">
              {allUsers.map(user => (
                <button
                  key={user.id}
                  onClick={() => handleSwitchUser(user)}
                  className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                    user.id === currentUser.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium"
                    style={{ backgroundColor: user.color }}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-gray-900">{user.name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="capitalize">{user.role}</span>
                      {user.homeLat && user.homeLng && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Home set
                        </span>
                      )}
                    </div>
                  </div>
                  {user.id === currentUser.id && (
                    <span className="text-xs text-blue-600 font-medium">Current</span>
                  )}
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                {allUsers.length} users • {allUsers.filter(u => u.homeLat && u.homeLng).length} with home address
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
