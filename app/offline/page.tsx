'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <img 
            src="/raydar-horizontal.png" 
            alt="Raydar" 
            className="h-12 mx-auto mb-8"
          />
        </div>
        
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="text-6xl mb-4">📡</div>
          <h1 className="text-2xl font-bold text-[#2D3748] mb-2">
            You're Offline
          </h1>
          <p className="text-[#718096] mb-6">
            Raydar needs an internet connection to load new data. Your cached data is still available.
          </p>
          
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-gradient-to-r from-[#FF5F5A] to-[#FF7A6B] text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            Try Again
          </button>
        </div>
        
        <p className="text-sm text-[#718096] mt-6">
          Check your internet connection and try again.
        </p>
      </div>
    </div>
  );
}
