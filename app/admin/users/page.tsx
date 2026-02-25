'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Users, Edit2, Trash2, Check, X, ArrowLeft, AlertTriangle, UserPlus 
} from 'lucide-react';
import { 
  User, UserRole, ROLE_LABELS, canManageUsers 
} from '@/app/types';
import { 
  getUsersAsync, saveUserAsync 
} from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { auth, createSecondaryAuth } from '@/app/utils/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';

export default function UsersManagementPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<User>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<{ name: string; email: string; password: string; role: UserRole }>(
    { name: '', email: '', password: '', role: 'setter' }
  );
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // Load current user and check permissions
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
          console.error('User not authorized for user management');
          router.push('/');
          return;
        }
        
        setCurrentUser(user);
        const allUsers = await getUsersAsync();
        setUsers(allUsers);
        setIsLoading(false);
      } catch (error) {
        console.error('User management page load error:', error);
        setIsLoading(false);
        router.push('/');
      }
    }
    
    loadData();
  }, [router]);

  const handleEditStart = (user: User) => {
    setEditingUserId(user.id);
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      homeAddress: user.homeAddress,
      isActive: user.isActive,
      territory: user.territory,
    });
  };

  const handleEditCancel = () => {
    setEditingUserId(null);
    setEditForm({});
  };

  const handleEditSave = async (userId: string) => {
    setIsSaving(true);
    
    try {
      const user = users.find(u => u.id === userId);
      if (!user) {
        console.error('User not found:', userId);
        alert('User not found');
        return;
      }

      const updatedUser: User = {
        ...user,
        ...editForm,
        name: editForm.name || user.name,
        email: editForm.email || user.email,
        role: editForm.role || user.role,
        requestedRole: editForm.role || user.requestedRole || user.role,
        approved: true,
        approvalStatus: 'approved',
      };

      console.log('Saving user:', updatedUser);
      await saveUserAsync(updatedUser);
      
      // Refresh users list
      const allUsers = await getUsersAsync();
      setUsers(allUsers);
      
      setEditingUserId(null);
      setEditForm({});
      console.log('User saved successfully');
    } catch (error: any) {
      console.error('Failed to save user:', error);
      alert(`Failed to save user: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    if (user.id === currentUser?.id) {
      alert('You cannot delete your own account');
      return;
    }

    if (!confirm(`Delete user "${user.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setDeletingUserId(userId);
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to delete user');
      }

      const allUsers = await getUsersAsync();
      setUsers(allUsers);
    } catch (error: any) {
      console.error('Delete user failed:', error);
      alert(error?.message || 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleToggleActive = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const updatedUser: User = {
      ...user,
      isActive: !user.isActive,
    };

    await saveUserAsync(updatedUser);
    
    // Refresh users list
    const allUsers = await getUsersAsync();
    setUsers(allUsers);
  };

  const handleApprovePending = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const updatedUser: User = {
      ...user,
      role: user.requestedRole || user.role,
      approved: true,
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    };

    await saveUserAsync(updatedUser);
    const allUsers = await getUsersAsync();
    setUsers(allUsers);
  };

  const randomColor = () => `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;

  const handleCreateUser = async () => {
    setCreateError('');
    setIsCreating(true);
    try {
      if (!createForm.name || !createForm.email || !createForm.password) {
        setCreateError('All fields are required');
        setIsCreating(false);
        return;
      }

      const secondary = await createSecondaryAuth();
      if (!secondary) {
        throw new Error('Firebase not initialized');
      }

      const cred = await createUserWithEmailAndPassword(secondary.auth, createForm.email, createForm.password);
      await secondary.dispose?.();

      const now = new Date();
      const newUser: User = {
        id: cred.user.uid,
        name: createForm.name,
        email: createForm.email,
        role: createForm.role,
        requestedRole: createForm.role,
        approved: true,
        approvalStatus: 'approved',
        createdAt: now,
        status: 'active',
        isActive: true,
        color: randomColor(),
      };

      await saveUserAsync(newUser);
      const allUsers = await getUsersAsync();
      setUsers(allUsers);
      setShowCreateModal(false);
      setCreateForm({ name: '', email: '', password: '', role: 'setter' });
    } catch (error: any) {
      console.error('Create user failed:', error);
      setCreateError(error?.message || 'Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7FAFC]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading users...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  const roleColors: Record<UserRole, string> = {
    setter: 'bg-green-100 text-green-800',
    closer: 'bg-blue-100 text-blue-800',
    manager: 'bg-purple-100 text-purple-800',
    admin: 'bg-red-100 text-red-800',
  };

  const pendingUsers = users.filter((u) => u.approvalStatus === 'pending');

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/admin')}
                className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#718096]" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-[#2D3748]">User Management</h1>
                <p className="text-sm text-[#718096]">Manage user accounts, roles, and permissions</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 bg-[#FF5F5A] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#E54E49] transition"
            >
              <UserPlus className="w-4 h-4" />
              Create User
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Total Users</div>
            <div className="text-3xl font-bold text-[#2D3748]">{users.length}</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Setters</div>
            <div className="text-3xl font-bold text-[#48BB78]">{users.filter(u => u.role === 'setter').length}</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Closers</div>
            <div className="text-3xl font-bold text-[#4299E1]">{users.filter(u => u.role === 'closer').length}</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Managers</div>
            <div className="text-3xl font-bold text-[#8B5CF6]">{users.filter(u => u.role === 'manager').length}</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Admins</div>
            <div className="text-3xl font-bold text-[#FF5F5A]">{users.filter(u => u.role === 'admin').length}</div>
          </div>
        </div>

        {pendingUsers.length > 0 && (
          <div className="bg-white border border-[#FBD38D] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-[#B7791F]">Pending Approvals</h2>
                <p className="text-sm text-[#B7791F]/80">Review manager/admin requests before they get access</p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FBD38D] text-[#744210]">
                {pendingUsers.length} awaiting
              </span>
            </div>
            <div className="space-y-3">
              {pendingUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between border border-[#FEEBC8] rounded-xl p-4 bg-[#FFF9F2]">
                  <div>
                    <p className="font-semibold text-[#2D3748]">{user.name}</p>
                    <p className="text-sm text-[#718096]">Requested: {ROLE_LABELS[user.requestedRole || user.role]}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApprovePending(user.id)}
                      className="px-3 py-1 rounded-lg text-sm font-semibold bg-[#48BB78] text-white hover:bg-[#38A169] transition"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleEditStart(user)}
                      className="px-3 py-1 rounded-lg text-sm font-semibold border border-[#E2E8F0] text-[#2D3748] hover:bg-[#F7FAFC] transition"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0]">
            <h2 className="text-lg font-semibold text-[#2D3748]">All Users</h2>
          </div>

          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[640px]">
              <thead className="bg-[#F7FAFC] border-b border-[#E2E8F0]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#718096] uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#718096] uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#718096] uppercase tracking-wider">
                    Territory
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#718096] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#718096] uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[#E2E8F0]">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-[#F7FAFC] transition-colors">
                    {editingUserId === user.id ? (
                      <>
                        {/* Edit Mode */}
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            value={editForm.name || ''}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                            placeholder="Name"
                          />
                          <input
                            type="email"
                            value={editForm.email || ''}
                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm mt-2 focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                            placeholder="Email"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <select
                            value={editForm.role || user.role}
                            onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                          >
                            {(['setter', 'closer', 'manager', 'admin'] as UserRole[]).map(role => (
                              <option key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            value={editForm.territory || ''}
                            onChange={(e) => setEditForm({ ...editForm, territory: e.target.value })}
                            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                            placeholder="Territory name"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editForm.isActive ?? user.isActive}
                              onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                              className="w-4 h-4 text-[#FF5F5A] border-[#E2E8F0] rounded focus:ring-[#FF5F5A]"
                            />
                            <span className="text-sm text-[#2D3748]">Active</span>
                          </label>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEditSave(user.id)}
                              disabled={isSaving}
                              className="p-2 text-[#48BB78] hover:bg-green-50 rounded-lg transition-colors"
                              title="Save"
                            >
                              <Check className="w-5 h-5" />
                            </button>
                            <button
                              onClick={handleEditCancel}
                              disabled={isSaving}
                              className="p-2 text-[#F56565] hover:bg-red-50 rounded-lg transition-colors"
                              title="Cancel"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        {/* View Mode */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
                              style={{ backgroundColor: user.color }}
                            >
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-[#2D3748]">{user.name}</div>
                              <div className="text-sm text-[#718096]">{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 space-y-2">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${roleColors[user.role]}`}>
                            {ROLE_LABELS[user.role]}
                          </span>
                          {user.approvalStatus === 'pending' && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#FEEBC8] text-[#C05621]">
                              Pending {ROLE_LABELS[user.requestedRole || user.role]}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-[#2D3748]">
                            {user.territory || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleToggleActive(user.id)}
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              user.isActive
                                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                            }`}
                          >
                            {user.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEditStart(user)}
                              className="p-2 text-[#4299E1] hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit user"
                            >
                              <Edit2 className="w-5 h-5" />
                            </button>
                            {user.id !== currentUser.id && (
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                disabled={deletingUserId === user.id}
                                className={`p-2 rounded-lg transition-colors ${deletingUserId === user.id ? 'text-[#F56565]/50 bg-red-50' : 'text-[#F56565] hover:bg-red-50'}`}
                                title="Delete user"
                              >
                                {deletingUserId === user.id ? (
                                  <div className="w-4 h-4 border-2 border-[#F56565] border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Trash2 className="w-5 h-5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Warning */}
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-1">Admin Access Required</h3>
              <p className="text-sm text-amber-700">
                Only users with Admin role can access this page. Be careful when changing user roles
                or deleting accounts - these actions cannot be undone.
              </p>
            </div>
          </div>
        </div>
      </main>
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-[#E2E8F0]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-[#2D3748]">Create User</h3>
                <p className="text-sm text-[#718096]">Generate an account and share the credentials</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-2 text-[#718096] hover:text-[#FF5F5A]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-[#2D3748] mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  placeholder="Jane Setter"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[#2D3748] mb-1 block">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  placeholder="user@company.com"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[#2D3748] mb-1 block">Temporary Password</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  placeholder="Minimum 6 characters"
                />
                <p className="text-xs text-[#718096] mt-1">Share this password manually — user can reset later.</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-[#2D3748] mb-1 block">Role</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                >
                  {(['setter', 'closer', 'manager', 'admin'] as UserRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              {createError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
                  {createError}
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-[#2D3748] font-semibold hover:bg-[#F7FAFC]"
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUser}
                disabled={isCreating}
                className="px-4 py-2 rounded-lg bg-[#FF5F5A] text-white font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                {isCreating && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Create User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
