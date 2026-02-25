'use client';

import { useEffect, useState } from 'react';
import { MapPin, AlertTriangle, Settings } from 'lucide-react';

interface LocationPermissionGuardProps {
  children: React.ReactNode;
  requireLocation?: boolean; // If false, just warn but allow usage
}

export default function LocationPermissionGuard({ 
  children, 
  requireLocation = true 
}: LocationPermissionGuardProps) {
  const [permissionStatus, setPermissionStatus] = useState<'checking' | 'granted' | 'denied' | 'prompt'>('checking');
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent || navigator.vendor;
    const ios = /iPad|iPhone|iPod/.test(userAgent);
    const android = /android/i.test(userAgent);
    
    setIsIOS(ios);
    setIsAndroid(android);

    checkLocationPermission();

    // Re-check periodically (every 5 seconds) to detect if user enables it
    const interval = setInterval(checkLocationPermission, 5000);

    return () => clearInterval(interval);
  }, []);

  const checkLocationPermission = async () => {
    if (!navigator.geolocation) {
      setPermissionStatus('denied');
      return;
    }

    try {
      // Try to get current position to check permission
      navigator.geolocation.getCurrentPosition(
        () => {
          setPermissionStatus('granted');
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setPermissionStatus('denied');
          } else {
            setPermissionStatus('prompt');
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 0,
        }
      );
    } catch (error) {
      setPermissionStatus('denied');
    }
  };

  const handleRequestPermission = () => {
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermissionStatus('granted');
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setPermissionStatus('denied');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  };

  // If location granted or not required, show children
  if (permissionStatus === 'granted' || permissionStatus === 'checking') {
    return <>{children}</>;
  }

  // Show blocking modal if location required and denied
  if (requireLocation && (permissionStatus === 'denied' || permissionStatus === 'prompt')) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FF5F5A] to-[#FF8A87] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
          {/* Icon */}
          <div className="w-20 h-20 bg-[#FF5F5A]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            {permissionStatus === 'denied' ? (
              <AlertTriangle className="w-10 h-10 text-[#FF5F5A]" />
            ) : (
              <MapPin className="w-10 h-10 text-[#FF5F5A]" />
            )}
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-center text-[#2D3748] mb-3">
            Location Access Required
          </h2>

          {/* Description */}
          <p className="text-center text-[#718096] mb-6">
            This app requires location access to verify door knocks and track field activity. 
            Location services must be enabled to continue.
          </p>

          {/* Why we need it */}
          <div className="bg-[#F7FAFC] rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-[#2D3748] mb-2">Why we need location:</h3>
            <ul className="space-y-2 text-sm text-[#718096]">
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] font-bold">•</span>
                <span>Verify you're at the door when knocking</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] font-bold">•</span>
                <span>Show your route on the activity map</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] font-bold">•</span>
                <span>Track team performance and coverage</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] font-bold">•</span>
                <span>Prevent fraudulent door knocking</span>
              </li>
            </ul>
          </div>

          {/* Instructions */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <Settings className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-yellow-800 mb-2">How to enable:</h4>
                
                {isIOS && (
                  <ol className="text-sm text-yellow-700 space-y-1 list-decimal list-inside">
                    <li>Open iPhone <strong>Settings</strong></li>
                    <li>Scroll down and tap <strong>Safari</strong> (or your browser)</li>
                    <li>Tap <strong>Location</strong></li>
                    <li>Select <strong>Ask</strong> or <strong>Allow</strong></li>
                    <li>Return to this page and allow location when prompted</li>
                  </ol>
                )}
                
                {isAndroid && (
                  <ol className="text-sm text-yellow-700 space-y-1 list-decimal list-inside">
                    <li>Open Android <strong>Settings</strong></li>
                    <li>Tap <strong>Apps</strong> or <strong>Applications</strong></li>
                    <li>Find and tap your <strong>browser</strong> (Chrome, etc.)</li>
                    <li>Tap <strong>Permissions</strong></li>
                    <li>Tap <strong>Location</strong> and select <strong>Allow</strong></li>
                    <li>Return to this page and allow location when prompted</li>
                  </ol>
                )}
                
                {!isIOS && !isAndroid && (
                  <p className="text-sm text-yellow-700">
                    Click the <strong>Request Access</strong> button below and allow location when your browser prompts you.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            {permissionStatus === 'prompt' && (
              <button
                onClick={handleRequestPermission}
                className="w-full bg-[#FF5F5A] hover:bg-[#FF4A45] text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Request Location Access
              </button>
            )}
            
            {permissionStatus === 'denied' && (
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-[#FF5F5A] hover:bg-[#FF4A45] text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                I've Enabled Location - Reload App
              </button>
            )}
          </div>

          {/* Help text */}
          <p className="text-xs text-center text-[#A0AEC0] mt-4">
            Location data is only used for door knock verification and activity tracking. 
            We do not share your location with third parties.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
