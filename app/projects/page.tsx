'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Edit2, Trash2, ChevronDown, ChevronRight, GripVertical, Check, Clock, Lightbulb } from 'lucide-react';

interface Feature {
  id: string;
  title: string;
  description: string;
  priority: 'now' | 'later' | 'someday';
  status: 'todo' | 'in-progress' | 'done';
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  features: Feature[];
  collapsed: boolean;
}

// Local storage key
const STORAGE_KEY = 'happysolar_projects';

const DEFAULT_PROJECTS: Project[] = [
  {
    id: 'happy-solar',
    name: 'Happy Solar Leads',
    description: 'Lead management and solar scoring app',
    icon: '☀️',
    color: '#f59e0b',
    collapsed: false,
    features: [
      {
        id: 'f1',
        title: 'CSV Upload with Geocoding',
        description: 'Upload leads from CSV and geocode addresses',
        priority: 'now',
        status: 'done',
        createdAt: '2026-02-06',
      },
      {
        id: 'f2',
        title: 'Google Solar API Integration',
        description: 'Score leads based on solar potential',
        priority: 'now',
        status: 'done',
        createdAt: '2026-02-06',
      },
      {
        id: 'f3',
        title: 'Smart Routing',
        description: 'Generate optimal door-to-door routes',
        priority: 'now',
        status: 'in-progress',
        createdAt: '2026-02-07',
      },
      {
        id: 'f4',
        title: 'Neighborhood Intel',
        description: 'Detect nearby solar installations and building data',
        priority: 'later',
        status: 'todo',
        createdAt: '2026-02-07',
      },
      {
        id: 'f5',
        title: 'Knock-to-Appointment Analytics',
        description: 'Track conversion rates and performance metrics',
        priority: 'later',
        status: 'todo',
        createdAt: '2026-02-07',
      },
      {
        id: 'f6',
        title: 'Weather Integration',
        description: 'Weather-aware routing and lead prioritization',
        priority: 'someday',
        status: 'todo',
        createdAt: '2026-02-07',
      },
    ],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw Assistant',
    description: 'AI butler and task automation',
    icon: '🎩',
    color: '#3b82f6',
    collapsed: true,
    features: [
      {
        id: 'f7',
        title: 'Sub-agent Management',
        description: 'Manage specialized AI agents',
        priority: 'now',
        status: 'in-progress',
        createdAt: '2026-02-06',
      },
      {
        id: 'f8',
        title: 'Voice Commands',
        description: 'Natural voice input for tasks',
        priority: 'later',
        status: 'todo',
        createdAt: '2026-02-06',
      },
    ],
  },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showAddFeature, setShowAddFeature] = useState<string | null>(null);
  const [newFeatureTitle, setNewFeatureTitle] = useState('');
  const [newFeatureDesc, setNewFeatureDesc] = useState('');
  const [newFeaturePriority, setNewFeaturePriority] = useState<'now' | 'later' | 'someday'>('later');
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectIcon, setNewProjectIcon] = useState('📁');
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setProjects(JSON.parse(saved));
      } catch {
        setProjects(DEFAULT_PROJECTS);
      }
    } else {
      setProjects(DEFAULT_PROJECTS);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    }
  }, [projects, isLoaded]);

  const saveProjects = (newProjects: Project[]) => {
    setProjects(newProjects);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newProjects));
  };

  const toggleProject = (projectId: string) => {
    saveProjects(projects.map(p => 
      p.id === projectId ? { ...p, collapsed: !p.collapsed } : p
    ));
  };

  const addFeature = (projectId: string) => {
    if (!newFeatureTitle.trim()) return;

    const feature: Feature = {
      id: Date.now().toString(),
      title: newFeatureTitle,
      description: newFeatureDesc,
      priority: newFeaturePriority,
      status: 'todo',
      createdAt: new Date().toISOString().split('T')[0],
    };

    saveProjects(projects.map(p => 
      p.id === projectId ? { ...p, features: [...p.features, feature] } : p
    ));

    setNewFeatureTitle('');
    setNewFeatureDesc('');
    setNewFeaturePriority('later');
    setShowAddFeature(null);
  };

  const addProject = () => {
    if (!newProjectName.trim()) return;

    const project: Project = {
      id: Date.now().toString(),
      name: newProjectName,
      description: newProjectDesc,
      icon: newProjectIcon,
      color: '#6b7280',
      collapsed: false,
      features: [],
    };

    setProjects([...projects, project]);
    setNewProjectName('');
    setNewProjectDesc('');
    setNewProjectIcon('📁');
    setShowAddProject(false);
  };

  const deleteFeature = (projectId: string, featureId: string) => {
    if (!confirm('Delete this feature?')) return;
    saveProjects(projects.map(p => 
      p.id === projectId ? { ...p, features: p.features.filter(f => f.id !== featureId) } : p
    ));
  };

  const updateFeatureStatus = (projectId: string, featureId: string, status: Feature['status']) => {
    saveProjects(projects.map(p => 
      p.id === projectId ? {
        ...p,
        features: p.features.map(f => f.id === featureId ? { ...f, status } : f)
      } : p
    ));
  };

  const startEditFeature = (feature: Feature) => {
    setEditingFeature(feature.id);
    setEditTitle(feature.title);
    setEditDesc(feature.description);
  };

  const saveEditFeature = (projectId: string, featureId: string) => {
    saveProjects(projects.map(p => 
      p.id === projectId ? {
        ...p,
        features: p.features.map(f => f.id === featureId ? { ...f, title: editTitle, description: editDesc } : f)
      } : p
    ));
    setEditingFeature(null);
  };

  const deleteProject = (projectId: string) => {
    if (!confirm('Delete this project and all its features?')) return;
    saveProjects(projects.filter(p => p.id !== projectId));
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'now': return 'bg-red-100 text-red-700';
      case 'later': return 'bg-yellow-100 text-yellow-700';
      case 'someday': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'bg-green-100 text-green-700';
      case 'in-progress': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getPriorityCount = (priority: string) => {
    return projects.reduce((acc, p) => acc + p.features.filter(f => f.priority === priority).length, 0);
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-gray-500">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Project Board</h1>
            <p className="text-sm text-gray-500">Track features and ideas</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-2 text-sm">
              <span className="px-2 py-1 bg-red-100 text-red-700 rounded">Now: {getPriorityCount('now')}</span>
              <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">Later: {getPriorityCount('later')}</span>
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">Someday: {getPriorityCount('someday')}</span>
            </div>
            <button
              onClick={() => setShowAddProject(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>
        </div>
      </header>

      {/* Project Board */}
      <div className="p-6 space-y-6">
        {projects.map(project => (
          <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Project Header */}
            <div 
              className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
              style={{ borderLeft: `4px solid ${project.color}` }}
              onClick={() => toggleProject(project.id)}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{project.icon}</span>
                <div>
                  <h2 className="font-semibold text-gray-900">{project.name}</h2>
                  <p className="text-sm text-gray-500">{project.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">
                  {project.features.filter(f => f.status === 'done').length}/{project.features.length} done
                </span>
                {project.collapsed ? (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}
                  className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Features */}
            {!project.collapsed && (
              <div className="border-t border-gray-100">
                {/* Add Feature */}
                {showAddFeature === project.id ? (
                  <div className="p-4 bg-blue-50 border-b border-blue-100">
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={newFeatureTitle}
                        onChange={(e) => setNewFeatureTitle(e.target.value)}
                        placeholder="Feature title..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                      <textarea
                        value={newFeatureDesc}
                        onChange={(e) => setNewFeatureDesc(e.target.value)}
                        placeholder="Description (optional)..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={2}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={newFeaturePriority}
                          onChange={(e) => setNewFeaturePriority(e.target.value as any)}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="now">🔴 Now</option>
                          <option value="later">🟡 Later</option>
                          <option value="someday">⚪ Someday</option>
                        </select>
                        <button
                          onClick={() => addFeature(project.id)}
                          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setShowAddFeature(null)}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddFeature(project.id)}
                    className="w-full px-4 py-3 text-sm text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Feature
                  </button>
                )}

                {/* Feature List */}
                {project.features.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {project.features.map(feature => (
                      <div key={feature.id} className="px-4 py-3 hover:bg-gray-50">
                        {editingFeature === feature.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                            <textarea
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEditFeature(project.id, feature.id)}
                                className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-sm"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingFeature(null)}
                                className="px-3 py-1 text-gray-600 hover:bg-gray-200 rounded text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col gap-1 mt-1">
                              {/* Status dropdown */}
                              <select
                                value={feature.status}
                                onChange={(e) => updateFeatureStatus(project.id, feature.id, e.target.value as any)}
                                className={`text-xs px-2 py-1 rounded border-0 cursor-pointer ${getStatusColor(feature.status)}`}
                              >
                                <option value="todo">○ Todo</option>
                                <option value="in-progress">◐ In Progress</option>
                                <option value="done">● Done</option>
                              </select>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-gray-900">{feature.title}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${getPriorityColor(feature.priority)}`}>
                                  {feature.priority === 'now' ? 'Now' : feature.priority === 'later' ? 'Later' : 'Someday'}
                                </span>
                              </div>
                              {feature.description && (
                                <p className="text-sm text-gray-500">{feature.description}</p>
                              )}
                              <p className="text-xs text-gray-400 mt-1">{feature.createdAt}</p>
                            </div>
                            <div className="flex gap-1">
                              <button
                                onClick={() => startEditFeature(feature)}
                                className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => deleteFeature(project.id, feature.id)}
                                className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center text-gray-400">
                    <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No features yet. Add one above!</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Project Modal */}
      {showAddProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">New Project</h2>
              <button onClick={() => setShowAddProject(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Project"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="What is this project about?"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
                <input
                  type="text"
                  value={newProjectIcon}
                  onChange={(e) => setNewProjectIcon(e.target.value)}
                  placeholder="📁"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={addProject}
                disabled={!newProjectName.trim()}
                className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
