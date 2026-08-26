'use client';

import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Users, ChevronDown, X, RefreshCw, LogOut, Search } from 'lucide-react';
import {
  getUsersAsync,
  getCurrentUserAsync,
  saveUserAsync,
  persistActingUser,
  resolveActingUser,
} from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { User as UserType, canSeeAllLeads } from '@/app/types';

interface UserSwitcherProps {
  onUserChange?: (user: UserType) => void;
  compact?: boolean;
}

function matchesUserQuery(user: UserType, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    user.name.toLowerCase().includes(q) ||
    (user.email || '').toLowerCase().includes(q) ||
    (user.role || '').toLowerCase().includes(q)
  );
}

const emptySubscribe = () => () => {};

export default function UserSwitcher({ onUserChange, compact = false }: UserSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [authUser, setAuthUser] = useState<UserType | null>(null);
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [allUsers, setAllUsers] = useState<UserType[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserHome, setNewUserHome] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    async function loadData() {
      const signedIn = await getCurrentAuthUser();
      setAuthUser(signedIn);
      const acting = await resolveActingUser();
      setCurrentUser(acting || (await getCurrentUserAsync()));
      const users = await getUsersAsync();
      setAllUsers(users);
    }
    loadData();
  }, []);

  const canViewAs = !!authUser && canSeeAllLeads(authUser.role);
  const isViewingAs = !!(authUser && currentUser && authUser.id !== currentUser.id);

  const filteredUsers = useMemo(() => {
    return allUsers
      .filter((user) => matchesUserQuery(user, userQuery))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allUsers, userQuery]);

  const closePicker = () => {
    setIsOpen(false);
    setUserQuery('');
  };

  const openPicker = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openedAtRef.current = Date.now();
    setUserQuery('');
    setIsOpen(true);
  };

  const closeFromBackdrop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Same-gesture pointerup/click lands on the new overlay after the pill's pointerdown.
    if (Date.now() - openedAtRef.current < 500) return;
    closePicker();
  };

  useEffect(() => {
    if (!isOpen || !compact) return;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, [isOpen, compact]);

  const handleSwitchUser = (user: UserType) => {
    persistActingUser(user);
    setCurrentUser(user);
    closePicker();
    onUserChange?.(user);
  };

  const handleExitViewAs = () => {
    if (!authUser) return;
    persistActingUser(authUser);
    setCurrentUser(authUser);
    closePicker();
    onUserChange?.(authUser);
  };

  const handleLogout = async () => {
    if (confirm('Log out? You can sign back in anytime.')) {
      localStorage.removeItem('raydar_current_user_id');
      window.location.reload();
    }
  };

  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim()) return;

    setIsCreating(true);

    const newUser: UserType = {
      id: Date.now().toString(),
      name: newUserName,
      email: newUserEmail,
      role: 'setter',
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
      createdAt: new Date(),
      assignedLeadCount: 0,
      isActive: true,
    };

    await saveUserAsync(newUser);

    const users = await getUsersAsync();
    setAllUsers(users);

    persistActingUser(newUser);
    setCurrentUser(newUser);

    setNewUserName('');
    setNewUserEmail('');
    setNewUserHome('');
    setShowAddUser(false);
    setIsCreating(false);
    setIsOpen(false);
    onUserChange?.(newUser);
  };

  if (!currentUser) return null;
  if (compact && !canViewAs) return null;

  const picker = (
    <>
      <div className={compact ? 'px-4 py-3 border-b border-gray-200' : 'px-4 py-3 border-b border-gray-200'}>
        <div className="flex items-center gap-2 rounded-lg bg-gray-100 border border-gray-200 px-3 py-2">
          <Search className="w-4 h-4 text-gray-500 flex-none" />
          <input
            ref={compact ? searchInputRef : undefined}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search setters…"
            className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-500 outline-none"
            data-testid="view-as-search"
          />
          {userQuery && (
            <button
              type="button"
              onClick={() => setUserQuery('')}
              className="h-6 w-6 flex items-center justify-center rounded-full hover:bg-gray-200"
              title="Clear"
            >
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {showAddUser && !compact && (
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

      <div className={compact ? 'flex-1 overflow-y-auto' : 'max-h-64 overflow-y-auto'}>
        {filteredUsers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No users match that search.</p>
        ) : (
          filteredUsers.map((user) => (
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
              <div className="flex-1 text-left min-w-0">
                <p className="font-medium text-gray-900 truncate">{user.name}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="capitalize">{user.role}</span>
                </div>
              </div>
              {user.id === currentUser.id && (
                <span className="text-xs text-blue-600 font-medium">Current</span>
              )}
            </button>
          ))
        )}
      </div>
    </>
  );

  if (compact) {
    return (
      <div className="relative flex items-center gap-2">
        <button
          type="button"
          onPointerDown={openPicker}
          onClick={openPicker}
          className="h-10 min-h-10 px-3 rounded-full bg-white border border-gray-200 text-[#2D3748] inline-flex items-center gap-2 leading-none whitespace-nowrap hover:bg-gray-50 touch-manipulation"
          title="View as another user"
          data-testid="view-as-button"
        >
          <Users className="w-3.5 h-3.5 text-[#718096]" />
          <span className="text-sm font-semibold leading-none truncate max-w-[140px]">
            {isViewingAs ? currentUser.name : 'View as'}
          </span>
        </button>
        {isViewingAs && (
          <button
            type="button"
            onClick={handleExitViewAs}
            className="h-10 min-h-10 px-3 rounded-full bg-[#FFF7ED] border border-[#FDBA74] text-[#9A3412] inline-flex items-center gap-1 leading-none whitespace-nowrap text-sm font-semibold"
            title="Return to signed-in admin"
            data-testid="view-as-exit"
          >
            Exit
          </button>
        )}

        {isOpen && mounted && createPortal(
          <div className="fixed inset-0 z-[80] pointer-events-none" data-testid="view-as-sheet">
            <div
              className="absolute inset-0 bg-black/30 pointer-events-auto"
              onPointerDown={closeFromBackdrop}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
            <div
              className="absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl shadow-2xl h-[80dvh] max-h-[80vh] flex flex-col overflow-hidden pointer-events-auto"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-semibold text-gray-800">View as</span>
                </div>
                <button
                  type="button"
                  onClick={closePicker}
                  className="h-10 w-10 rounded-full hover:bg-gray-100 flex items-center justify-center"
                  title="Close"
                >
                  <X className="w-5 h-5 text-[#718096]" />
                </button>
              </div>
              {isViewingAs && (
                <div className="px-4 py-2 bg-[#FFF7ED] border-b border-[#FDBA74] flex items-center justify-between gap-2">
                  <p className="text-xs text-[#9A3412] truncate">
                    Viewing as {currentUser.name}. Exit restores {authUser?.name}.
                  </p>
                  <button
                    type="button"
                    onClick={handleExitViewAs}
                    className="text-xs font-semibold text-[#9A3412] underline"
                  >
                    Exit
                  </button>
                </div>
              )}
              {picker}
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => canViewAs && setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
        data-testid="view-as-button"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
          style={{ backgroundColor: currentUser.color }}
        >
          {currentUser.name.charAt(0).toUpperCase()}
        </div>
        <div className="hidden md:block text-left">
          <p className="text-sm font-medium text-gray-700">{currentUser.name}</p>
          <p className="text-xs text-gray-500 capitalize">
            {isViewingAs ? `Viewing as ${currentUser.role}` : currentUser.role}
          </p>
        </div>
        {canViewAs && <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {isOpen && canViewAs && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-20 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">View as</span>
              </div>
              <button
                onClick={() => setShowAddUser(!showAddUser)}
                className="p-1 hover:bg-gray-200 rounded"
              >
                {showAddUser ? <X className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            </div>

            {isViewingAs && (
              <div className="px-4 py-2 bg-[#FFF7ED] border-b border-[#FDBA74] flex items-center justify-between gap-2">
                <p className="text-xs text-[#9A3412] truncate">
                  Viewing as {currentUser.name}
                </p>
                <button
                  type="button"
                  onClick={handleExitViewAs}
                  className="text-xs font-semibold text-[#9A3412] underline"
                  data-testid="view-as-exit"
                >
                  Exit
                </button>
              </div>
            )}

            {picker}

            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">
                  {filteredUsers.length} of {allUsers.length} users
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
