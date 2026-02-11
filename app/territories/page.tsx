'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Map, Users, Plus, Edit2, Trash2, X, Check, 
  TrendingUp, MapPin, UserCheck, Shield, ChevronRight
} from 'lucide-react';
import { 
  User, canManageUsers, canAssignLeads 
} from '@/app/types';
import { 
  getUsersAsync, getCurrentUserAsync, saveUserAsync 
} from '@/app/utils/storage';

interface Territory {
  id: string;
  name: string;
  description?: string;
  color: string;
  createdAt: Date;
  userIds: string[];
}

export default function TerritoriesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', color: '#3b82f6' });

  // Territory colors (Apple-inspired palette)
  const territoryColors = [
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#10b981', // Green
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#06b6d4', // Cyan
    '#6366f1', // Indigo
  ];

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentUserAsync();
      
      if (!user || (!canManageUsers(user.role) && !canAssignLeads(user.role))) {
        router.push('/');
        return;
      }
      
      setCurrentUser(user);
      const allUsers = await getUsersAsync();
      setUsers(allUsers);
      
      // Load territories from user.territory field (group users by territory)
      const territoryMap: { [key: string]: Territory } = {};
      let colorIndex = 0;
      
      allUsers.forEach(u => {
        if (u.territory) {
          if (!territoryMap[u.territory]) {
            territoryMap[u.territory] = {
              id: u.territory.toLowerCase().replace(/\s+/g, '-'),
              name: u.territory,
              color: territoryColors[colorIndex % territoryColors.length],
              createdAt: u.createdAt,
              userIds: [],
            };
            colorIndex++;
          }
          territoryMap[u.territory].userIds.push(u.id);
        }
      });
      
      setTerritories(Object.values(territoryMap));
      setIsLoading(false);
    }
    
    loadData();
  }, [router]);

  const handleCreateTerritory = async () => {
    if (!formData.name.trim()) return;

    const newTerritory: Territory = {
      id: formData.name.toLowerCase().replace(/\s+/g, '-'),
      name: formData.name,
      description: formData.description,
      color: formData.color,
      createdAt: new Date(),
      userIds: [],
    };

    setTerritories([...territories, newTerritory]);
    setShowCreateModal(false);
    setFormData({ name: '', description: '', color: '#3b82f6' });
  };

  const handleEditTerritory = async (territory: Territory) => {
    if (!formData.name.trim()) return;

    // Update all users in this territory with new name
    const usersInTerritory = users.filter(u => u.territory === territory.name);
    for (const user of usersInTerritory) {
      await saveUserAsync({
        ...user,
        territory: formData.name,
      });
    }

    // Refresh
    const allUsers = await getUsersAsync();
    setUsers(allUsers);
    
    const territoryMap: { [key: string]: Territory } = {};
    allUsers.forEach(u => {
      if (u.territory) {
        if (!territoryMap[u.territory]) {
          territoryMap[u.territory] = {
            id: u.territory.toLowerCase().replace(/\s+/g, '-'),
            name: u.territory,
            color: formData.color,
            createdAt: u.createdAt,
            userIds: [],
          };
        }
        territoryMap[u.territory].userIds.push(u.id);
      }
    });
    
    setTerritories(Object.values(territoryMap));
    setEditingTerritory(null);
    setFormData({ name: '', description: '', color: '#3b82f6' });
  };

  const handleDeleteTerritory = async (territory: Territory) => {
    if (!confirm(`Remove territory "${territory.name}"? Users will remain but lose territory assignment.`)) {
      return;
    }

    // Remove territory from all users
    const usersInTerritory = users.filter(u => u.territory === territory.name);
    for (const user of usersInTerritory) {
      await saveUserAsync({
        ...user,
        territory: undefined,
      });
    }

    // Refresh
    const allUsers = await getUsersAsync();
    setUsers(allUsers);
    setTerritories(territories.filter(t => t.id !== territory.id));
  };

  const handleAssignUser = async (userId: string, territoryName: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    await saveUserAsync({
      ...user,
      territory: territoryName,
    });

    // Refresh
    const allUsers = await getUsersAsync();
    setUsers(allUsers);
    
    const territoryMap: { [key: string]: Territory } = {};
    let colorIdx = 0;
    allUsers.forEach(u => {
      if (u.territory) {
        if (!territoryMap[u.territory]) {
          const existing = territories.find(t => t.name === u.territory);
          territoryMap[u.territory] = {
            id: u.territory.toLowerCase().replace(/\s+/g, '-'),
            name: u.territory,
            color: existing?.color || territoryColors[colorIdx % territoryColors.length],
            createdAt: u.createdAt,
            userIds: [],
          };
          colorIdx++;
        }
        territoryMap[u.territory].userIds.push(u.id);
      }
    });
    
    setTerritories(Object.values(territoryMap));
  };

  const unassignedUsers = users.filter(u => !u.territory);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading territories...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Header - Apple-style */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button
                onClick={() => router.push('/')}
                className="p-3 hover:bg-gray-100/80 rounded-2xl transition-all duration-200 hover:scale-105"
              >
                <ChevronRight className="w-6 h-6 text-gray-600 rotate-180" />
              </button>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-lg shadow-blue-500/20">
                    <Map className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                    Territories
                  </h1>
                </div>
                <p className="text-gray-500 text-sm font-medium ml-16">
                  Organize your team by region and track performance
                </p>
              </div>
            </div>

            {canManageUsers(currentUser.role) && (
              <button
                onClick={() => {
                  setFormData({ name: '', description: '', color: territoryColors[territories.length % territoryColors.length] });
                  setShowCreateModal(true);
                }}
                className="group flex items-center gap-3 px-6 py-3.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-2xl font-semibold shadow-lg shadow-blue-500/30 transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-blue-500/40"
              >
                <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                <span>New Territory</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Stats Cards - iOS-inspired */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="group bg-white rounded-3xl p-8 shadow-sm border border-gray-100 hover:shadow-xl hover:border-gray-200 transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
              <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl">
                <Map className="w-7 h-7 text-blue-600" />
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-gray-900">{territories.length}</div>
                <div className="text-sm font-medium text-gray-500 mt-1">Territories</div>
              </div>
            </div>
            <div className="h-1.5 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full" />
          </div>

          <div className="group bg-white rounded-3xl p-8 shadow-sm border border-gray-100 hover:shadow-xl hover:border-gray-200 transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
              <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl">
                <Users className="w-7 h-7 text-purple-600" />
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-gray-900">{users.filter(u => u.territory).length}</div>
                <div className="text-sm font-medium text-gray-500 mt-1">Assigned</div>
              </div>
            </div>
            <div className="h-1.5 bg-gradient-to-r from-purple-500 to-purple-600 rounded-full" />
          </div>

          <div className="group bg-white rounded-3xl p-8 shadow-sm border border-gray-100 hover:shadow-xl hover:border-gray-200 transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
              <div className="p-4 bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl">
                <UserCheck className="w-7 h-7 text-amber-600" />
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-gray-900">{unassignedUsers.length}</div>
                <div className="text-sm font-medium text-gray-500 mt-1">Unassigned</div>
              </div>
            </div>
            <div className="h-1.5 bg-gradient-to-r from-amber-500 to-amber-600 rounded-full" />
          </div>
        </div>

        {/* Territories Grid */}
        {territories.length === 0 ? (
          <div className="text-center py-20">
            <div className="p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-full w-24 h-24 mx-auto mb-6 flex items-center justify-center">
              <Map className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">No territories yet</h3>
            <p className="text-gray-500 mb-8 max-w-md mx-auto">
              Create your first territory to start organizing your team by region
            </p>
            {canManageUsers(currentUser.role) && (
              <button
                onClick={() => {
                  setFormData({ name: '', description: '', color: territoryColors[0] });
                  setShowCreateModal(true);
                }}
                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-2xl font-semibold shadow-lg shadow-blue-500/30 transition-all duration-200 hover:scale-105"
              >
                <Plus className="w-5 h-5" />
                Create Territory
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {territories.map((territory) => {
              const territoryUsers = users.filter(u => u.territory === territory.name);
              
              return (
                <div
                  key={territory.id}
                  className="group bg-white rounded-3xl p-8 shadow-sm border border-gray-100 hover:shadow-2xl hover:border-gray-200 transition-all duration-300"
                >
                  {/* Territory Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div
                        className="w-14 h-14 rounded-2xl shadow-lg flex items-center justify-center"
                        style={{ 
                          background: `linear-gradient(135deg, ${territory.color}dd, ${territory.color})`,
                        }}
                      >
                        <MapPin className="w-7 h-7 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-1">{territory.name}</h3>
                        <p className="text-sm text-gray-500 font-medium">
                          {territoryUsers.length} team member{territoryUsers.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    {canManageUsers(currentUser.role) && (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button
                          onClick={() => {
                            setEditingTerritory(territory);
                            setFormData({ 
                              name: territory.name, 
                              description: territory.description || '',
                              color: territory.color,
                            });
                          }}
                          className="p-3 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all duration-200"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTerritory(territory)}
                          className="p-3 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Team Members */}
                  <div className="space-y-3">
                    {territoryUsers.map(user => (
                      <div
                        key={user.id}
                        className="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-50 to-gray-50/50 rounded-2xl hover:from-gray-100 hover:to-gray-50 transition-all duration-200"
                      >
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md"
                          style={{ backgroundColor: user.color }}
                        >
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500 capitalize">{user.role}</div>
                        </div>
                        {canManageUsers(currentUser.role) && (
                          <button
                            onClick={() => handleAssignUser(user.id, '')}
                            className="text-sm text-gray-500 hover:text-red-600 font-medium transition-colors duration-200"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}

                    {canManageUsers(currentUser.role) && unassignedUsers.length > 0 && (
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAssignUser(e.target.value, territory.name);
                            e.target.value = '';
                          }
                        }}
                        className="w-full px-4 py-3 bg-white border-2 border-dashed border-gray-300 rounded-2xl text-gray-600 font-medium hover:border-blue-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all duration-200"
                      >
                        <option value="">+ Add team member...</option>
                        {unassignedUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.role})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Unassigned Users Section */}
        {unassignedUsers.length > 0 && (
          <div className="mt-12 bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl">
                <Users className="w-6 h-6 text-gray-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Unassigned Users</h3>
                <p className="text-sm text-gray-500">Assign these users to territories</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unassignedUsers.map(user => (
                <div
                  key={user.id}
                  className="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-50 to-gray-50/50 rounded-2xl border border-gray-200"
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md"
                    style={{ backgroundColor: user.color }}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900">{user.name}</div>
                    <div className="text-sm text-gray-500 capitalize">{user.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Create/Edit Modal - Apple-style */}
      {(showCreateModal || editingTerritory) && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => {
              setShowCreateModal(false);
              setEditingTerritory(null);
              setFormData({ name: '', description: '', color: '#3b82f6' });
            }}
          />
          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div 
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
            {/* Modal Header */}
            <div className="p-8 pb-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">
                  {editingTerritory ? 'Edit Territory' : 'New Territory'}
                </h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingTerritory(null);
                    setFormData({ name: '', description: '', color: '#3b82f6' });
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all duration-200"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Form */}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Territory Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Phoenix North, Scottsdale..."
                    className="w-full px-4 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-2xl font-medium focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all duration-200"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Description (Optional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Downtown area, residential zones..."
                    rows={3}
                    className="w-full px-4 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-2xl font-medium focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all duration-200 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Color
                  </label>
                  <div className="grid grid-cols-8 gap-3">
                    {territoryColors.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-10 h-10 rounded-xl transition-all duration-200 hover:scale-110 ${
                          formData.color === color
                            ? 'ring-4 ring-offset-2 ring-gray-400 scale-110'
                            : 'hover:ring-2 hover:ring-offset-2 hover:ring-gray-300'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-6 bg-gray-50 flex gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingTerritory(null);
                  setFormData({ name: '', description: '', color: '#3b82f6' });
                }}
                className="flex-1 px-6 py-3.5 bg-white border-2 border-gray-200 text-gray-700 font-semibold rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => editingTerritory ? handleEditTerritory(editingTerritory) : handleCreateTerritory()}
                disabled={!formData.name.trim()}
                className="flex-1 px-6 py-3.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded-2xl shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-blue-500/40"
              >
                {editingTerritory ? 'Save Changes' : 'Create Territory'}
              </button>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
