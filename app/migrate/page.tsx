'use client';

import { useState } from 'react';
import { migrateFromLocalStorage } from '@/app/utils/firestore';
import { Database, CheckCircle, XCircle, Loader } from 'lucide-react';

export default function MigratePage() {
  const [status, setStatus] = useState<'idle' | 'migrating' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleMigrate = async () => {
    setStatus('migrating');
    setMessage('Migrating data from localStorage to Firestore...');
    
    try {
      await migrateFromLocalStorage();
      setStatus('success');
      setMessage('Migration completed successfully! All data has been moved to Firestore.');
    } catch (error) {
      setStatus('error');
      setMessage(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error('Migration error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <Database className="w-16 h-16 mx-auto text-blue-600 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Migrate to Firestore
          </h1>
          <p className="text-gray-600">
            Move your data from localStorage to Firebase Cloud Database
          </p>
        </div>

        {status === 'idle' && (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>Before migrating:</strong> Make sure Firestore is enabled in your Firebase Console.
              </p>
            </div>
            <button
              onClick={handleMigrate}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Start Migration
            </button>
          </div>
        )}

        {status === 'migrating' && (
          <div className="text-center py-8">
            <Loader className="w-12 h-12 mx-auto text-blue-600 animate-spin mb-4" />
            <p className="text-gray-700">{message}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center py-8">
            <CheckCircle className="w-16 h-16 mx-auto text-green-600 mb-4" />
            <p className="text-gray-700 mb-6">{message}</p>
            <a
              href="/"
              className="inline-block py-2 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
            >
              Go to Dashboard
            </a>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-8">
            <XCircle className="w-16 h-16 mx-auto text-red-600 mb-4" />
            <p className="text-gray-700 mb-6">{message}</p>
            <button
              onClick={() => setStatus('idle')}
              className="py-2 px-6 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">What gets migrated:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>✓ All leads</li>
            <li>✓ All users</li>
            <li>✓ Lead assignments</li>
            <li>✓ Solar scores</li>
            <li>✓ Disposition history</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
