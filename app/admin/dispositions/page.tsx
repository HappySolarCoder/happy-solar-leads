'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Plus, Edit2, Trash2, X, Check, ArrowLeft, Save,
  Circle, Target, Home, Star, XCircle, CheckCircle, Calendar,
  Phone, Mail, User, Users, Clock, AlertCircle, HelpCircle,
  ThumbsUp, ThumbsDown, Flag, Bookmark, Heart, MapPin,
  DoorOpen, DoorClosed, Bell, MessageSquare, FileText, Clipboard
} from 'lucide-react';
import { canManageUsers } from '@/app/types';
import { getCurrentUserAsync } from '@/app/utils/storage';

// Simple User type for this page
interface User {
  id: string;
  name: string;
  role: 'setter' | 'closer' | 'manager' | 'admin';
}
import { 
  getDispositionsAsync, 
  saveDispositionAsync, 
  deleteDispositionAsync,
  updateDispositionOrderAsync,
  generateDispositionId 
} from '@/app/utils/dispositions';
import { Disposition, AVAILABLE_ICONS, DISPOSITION_COLORS } from '@/app/types/disposition';

// Icon map for rendering
const ICON_MAP: Record<string, any> = {
  'circle': Circle,
  'target': Target,
  'home': Home,
  'star': Star,
  'x-circle': XCircle,
  'check-circle': CheckCircle,
  'calendar': Calendar,
  'phone': Phone,
  'mail': Mail,
  'user': User,
  'users': Users,
  'clock': Clock,
  'alert-circle': AlertCircle,
  'help-circle': HelpCircle,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'flag': Flag,
  'bookmark': Bookmark,
  'heart': Heart,
  'map-pin': MapPin,
  'door-open': DoorOpen,
  'door-closed': DoorClosed,
  'bell': Bell,
  'message-square': MessageSquare,
  'file-text': FileText,
  'clipboard': Clipboard,
};

export default function DispositionsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingDispo, setEditingDispo] = useState<Disposition | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#3B82F6',
    icon: 'circle',
    countsAsDoorKnock: true,
    specialBehavior: 'none' as 'scheduling-manager' | 'none',
  });

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentUserAsync();
      
      if (!user || !canManageUsers(user.role)) {
        router.push('/');
        return;
      }
      
      setCurrentUser(user);
      const dispos = await getDispositionsAsync();
      setDispositions(dispos);
      setIsLoading(false);
    }
    
    loadData();
  }, [router]);

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    const id = editingDispo?.id || generateDispositionId(formData.name);
    
    const disposition: Disposition = {
      id,
      name: formData.name,
      color: formData.color,
      icon: formData.icon,
      countsAsDoorKnock: formData.countsAsDoorKnock,
      specialBehavior: formData.specialBehavior === 'none' ? undefined : formData.specialBehavior,
      order: editingDispo?.order ?? dispositions.length,
      isDefault: editingDispo?.isDefault ?? false,
      createdAt: editingDispo?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    await saveDispositionAsync(disposition);
    
    // Reload
    const dispos = await getDispositionsAsync();
    setDispositions(dispos);
    
    setShowCreateModal(false);
    setEditingDispo(null);
    setFormData({ name: '', color: '#3B82F6', icon: 'circle', countsAsDoorKnock: true, specialBehavior: 'none' });
  };

  const handleEdit = (dispo: Disposition) => {
    setEditingDispo(dispo);
    setFormData({
      name: dispo.name,
      color: dispo.color,
      icon: dispo.icon,
      countsAsDoorKnock: dispo.countsAsDoorKnock,
      specialBehavior: dispo.specialBehavior || 'none',
    });
    setShowCreateModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this disposition? All leads with this status will need reassignment.')) return;
    
    try {
      await deleteDispositionAsync(id);
      const dispos = await getDispositionsAsync();
      setDispositions(dispos);
    } catch (error: any) {
      alert(error.message || 'Cannot delete this disposition');
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const newDispositions = [...dispositions];
    const [draggedItem] = newDispositions.splice(draggedIndex, 1);
    newDispositions.splice(dropIndex, 0, draggedItem);

    setDispositions(newDispositions);
    setDraggedIndex(null);

    // Save new order to Firestore
    try {
      await updateDispositionOrderAsync(newDispositions);
    } catch (error) {
      console.error('Error saving order:', error);
      alert('Failed to save new order');
    }
  };

  const IconComponent = ICON_MAP[formData.icon] || Circle;
  
  const doorKnockCount = dispositions.filter(d => d.countsAsDoorKnock).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
                <h1 className="text-2xl font-bold text-[#2D3748]">Disposition Management</h1>
                <p className="text-sm text-[#718096]">Customize status options and tracking</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('=== NEW DISPOSITION CLICKED ===');
                console.log('Current showCreateModal:', showCreateModal);
                setEditingDispo(null);
                setFormData({ name: '', color: '#3B82F6', icon: 'circle', countsAsDoorKnock: true, specialBehavior: 'none' });
                setShowCreateModal(true);
                console.log('Set showCreateModal to true');
              }}
              className="flex items-center gap-2 px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-semibold transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Plus className="w-4 h-4" />
              New Disposition
            </button>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Total Dispositions</div>
            <div className="text-3xl font-bold text-[#2D3748]">{dispositions.length}</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="text-sm text-[#718096] mb-1">Door Knock Tracking</div>
            <div className="text-3xl font-bold text-[#FF5F5A]">{doorKnockCount}</div>
          </div>
        </div>

        {/* Dispositions List */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="p-4 border-b border-[#E2E8F0] bg-[#F7FAFC]">
            <p className="text-sm text-[#718096]">💡 Drag and drop to reorder dispositions</p>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {dispositions.map((dispo, index) => {
              const Icon = ICON_MAP[dispo.icon] || Circle;
              const isDragging = draggedIndex === index;
              return (
                <div
                  key={dispo.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`p-6 transition-all cursor-move ${
                    isDragging ? 'opacity-50 bg-[#FF5F5A]/5' : 'hover:bg-[#F7FAFC]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {/* Drag Handle */}
                      <div className="cursor-grab active:cursor-grabbing">
                        <svg className="w-5 h-5 text-[#718096]" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"></path>
                        </svg>
                      </div>
                      
                      {/* Icon */}
                      <div 
                        className="w-12 h-12 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${dispo.color}20` }}
                      >
                        <Icon className="w-6 h-6" style={{ color: dispo.color }} />
                      </div>
                      
                      {/* Info */}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-[#2D3748]">{dispo.name}</h3>
                          {dispo.countsAsDoorKnock && (
                            <span className="text-xs px-2 py-0.5 bg-[#FF5F5A]/10 text-[#FF5F5A] rounded font-medium">Door Knock</span>
                          )}
                          {dispo.specialBehavior === 'scheduling-manager' && (
                            <span className="text-xs px-2 py-0.5 bg-[#4299E1]/10 text-[#4299E1] rounded font-medium">Special</span>
                          )}
                        </div>
                        <div className="text-sm text-[#718096] mt-1">
                          Color: {dispo.color} • Icon: {dispo.icon}
                        </div>
                      </div>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(dispo)}
                        className="p-2 hover:bg-white border border-transparent hover:border-[#E2E8F0] rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4 text-[#718096]" />
                      </button>
                      <button
                        onClick={() => handleDelete(dispo.id)}
                        className="p-2 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <>
          {console.log('=== MODAL RENDERING ===', { showCreateModal, editingDispo, formData })}
          {/* DEBUG: Bright red indicator to see if modal is rendering */}
          <div className="fixed top-0 left-0 w-32 h-32 bg-red-500 z-[9999]" style={{ background: 'red' }}>
            MODAL HERE
          </div>
          <div 
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div 
              className="bg-white rounded-lg shadow-2xl max-w-2xl w-full pointer-events-auto max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-[#2D3748]">
                    {editingDispo ? 'Edit Disposition' : 'Create Disposition'}
                  </h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="p-2 hover:bg-[#F7FAFC] rounded-lg"
                  >
                    <X className="w-5 h-5 text-[#718096]" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-6">
                {/* Name */}
                <div>
                  <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                    Disposition Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Follow Up Later, Callback..."
                    className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-3 focus:ring-[#FF5F5A]/10"
                  />
                </div>

                {/* Preview */}
                <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg p-4">
                  <div className="text-sm font-semibold text-[#2D3748] mb-3">Preview</div>
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${formData.color}20` }}
                    >
                      <IconComponent className="w-6 h-6" style={{ color: formData.color }} />
                    </div>
                    <div>
                      <div className="font-semibold text-[#2D3748]">{formData.name || 'Disposition Name'}</div>
                      <div className="text-sm text-[#718096]">Map pin and status</div>
                    </div>
                  </div>
                </div>

                {/* Color Picker */}
                <div>
                  <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                    Color
                  </label>
                  <div className="grid grid-cols-10 gap-2">
                    {DISPOSITION_COLORS.map(color => (
                      <button
                        key={color.hex}
                        type="button"
                        onClick={() => setFormData({ ...formData, color: color.hex })}
                        className={`w-10 h-10 rounded-lg transition-all ${
                          formData.color === color.hex
                            ? 'ring-2 ring-offset-2 ring-[#2D3748] scale-110'
                            : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Icon Picker */}
                <div>
                  <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                    Icon
                  </label>
                  <div className="grid grid-cols-8 gap-2">
                    {AVAILABLE_ICONS.map(iconName => {
                      const Icon = ICON_MAP[iconName] || Circle;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => setFormData({ ...formData, icon: iconName })}
                          className={`w-12 h-12 flex items-center justify-center rounded-lg border-2 transition-all ${
                            formData.icon === iconName
                              ? 'border-[#FF5F5A] bg-[#FF5F5A]/10'
                              : 'border-[#E2E8F0] hover:border-[#FF5F5A]/50'
                          }`}
                        >
                          <Icon className="w-5 h-5 text-[#2D3748]" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Door Knock Toggle */}
                <div>
                  <label className="flex items-center gap-3 p-4 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg cursor-pointer hover:bg-white transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.countsAsDoorKnock}
                      onChange={(e) => setFormData({ ...formData, countsAsDoorKnock: e.target.checked })}
                      className="w-5 h-5 text-[#FF5F5A] border-[#E2E8F0] rounded focus:ring-[#FF5F5A]"
                    />
                    <div>
                      <div className="font-semibold text-[#2D3748]">Count as Door Knock</div>
                      <div className="text-sm text-[#718096]">Track this disposition in door knock metrics</div>
                    </div>
                  </label>
                </div>

                {/* Special Behavior */}
                <div>
                  <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                    Special Behavior (Optional)
                  </label>
                  <select
                    value={formData.specialBehavior}
                    onChange={(e) => setFormData({ ...formData, specialBehavior: e.target.value as any })}
                    className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#FF5F5A] focus:ring-3 focus:ring-[#FF5F5A]/10"
                  >
                    <option value="none">None (Standard disposition)</option>
                    <option value="scheduling-manager">Scheduling Manager (Edit lead + call)</option>
                  </select>
                  {formData.specialBehavior === 'scheduling-manager' && (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                      ℹ️ This will open lead editor with call button instead of standard disposition.
                      Configure phone number and notifications in <button onClick={() => router.push('/admin/settings')} className="underline font-semibold">Settings</button>.
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-[#E2E8F0] flex gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-6 py-3 border-2 border-[#E2E8F0] text-[#2D3748] font-semibold rounded-lg hover:bg-[#F7FAFC] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formData.name.trim()}
                  className="flex-1 px-6 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:-translate-y-0.5 hover:shadow-lg"
                >
                  {editingDispo ? 'Save Changes' : 'Create Disposition'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
