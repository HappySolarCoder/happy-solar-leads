'use client';

import { useState, useRef } from 'react';
import { Upload, File, X, MapPin, CheckCircle, AlertCircle } from 'lucide-react';
import { CSVRow, Lead } from '@/app/types';
import { parseCSV, validateCSV } from '@/app/utils/csv';
import { geocodeBatch } from '@/app/utils/geocode';
import { addLead, getLeads, generateId } from '@/app/utils/storage';

// Client-side logger that sends to server
function logToFile(level: string, component: string, message: string, data: any = {}) {
  console.log(`[${level}] [${component}] ${message}`, data);

  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, component, message, data }),
  }).catch(() => {}); // Silent fail
}

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (count: number) => void;
}

export default function UploadModal({ isOpen, onClose, onComplete }: UploadModalProps) {
  const [step, setStep] = useState<'upload' | 'processing' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [geocoded, setGeocoded] = useState<Array<{ row: CSVRow; lat?: number; lng?: number }>>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [failedAddresses, setFailedAddresses] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }

    setFile(selectedFile);
    setError(null);

    try {
      const parsedRows = await parseCSV(selectedFile);
      setRows(parsedRows);

      const validation = validateCSV(parsedRows);
      if (!validation.valid) {
        setError(validation.errors.join('\n'));
        return;
      }
    } catch (err) {
      setError('Failed to parse CSV file. Please check the format.');
    }
  };

  const handleProcess = async () => {
    if (rows.length === 0) return;

    setStep('processing');
    setProgress({ current: 0, total: rows.length * 2 }); // Geocode + Solar
    setError(null);

    try {
      logToFile('INFO', 'UploadModal', 'Starting geocode batch', { rowCount: rows.length });

      // Step 1: Geocode all addresses
      const geocodeResults = await geocodeBatch(rows, (current, total) => {
        logToFile('INFO', 'UploadModal', 'Geocode progress', { current, total });
        setProgress({ current, total: rows.length * 2 });
      });

      // Filter successful geocodes
      const geocodedSuccess = geocodeResults.filter(r => r.lat && r.lng);
      const geocodedFailed = geocodeResults.filter(r => !r.lat || !r.lng);

      logToFile('INFO', 'UploadModal', 'Geocode complete', { success: geocodedSuccess.length, failed: geocodedFailed.length });

      // Step 2: Fetch solar data for each geocoded lead
      const newLeads: Lead[] = [];
      const skippedDuplicates: string[] = [];
      
      // Load existing leads to check for duplicates
      const existingLeads = getLeads();
      const existingAddresses = new Set(existingLeads.map(l => 
        `${l.address.toLowerCase().trim()}, ${l.city.toLowerCase().trim()}, ${l.state.toLowerCase().trim()} ${l.zip}`
      ));
      
      for (let i = 0; i < geocodedSuccess.length; i++) {
        const result = geocodedSuccess[i];
        
        // Check for duplicate address
        const normalizedAddress = `${result.row.address?.toLowerCase().trim()}, ${result.row.city?.toLowerCase().trim()}, ${result.row.state?.toLowerCase().trim()} ${result.row.zip}`;
        if (existingAddresses.has(normalizedAddress)) {
          logToFile('INFO', 'UploadModal', 'Skipping duplicate', { address: result.row.address });
          skippedDuplicates.push(result.row.address || 'Unknown');
          continue;
        }
        
        try {
          // Fetch solar data
          const solarResp = await fetch('/api/solar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: result.lat, lng: result.lng })
          });
          
          const solarData = await solarResp.json();
          
          // Calculate solar score
          let solarScore = 0;
          let solarCategory: 'poor' | 'solid' | 'good' | 'great' = 'poor';
          let hasSouthFacing = false;
          
          if (solarData.solarPotential) {
            const sunshineHours = solarData.solarPotential.maxSunshineHoursPerYear || 0;
            const maxPanels = solarData.solarPotential.maxArrayPanelsCount || 0;
            
            // Check for south-facing roof
            if (solarData.solarPotential.roofSegmentStats) {
              for (const segment of solarData.solarPotential.roofSegmentStats) {
                const azimuthDiff = Math.abs(segment.azimuthDegrees - 180);
                if (azimuthDiff <= 45) {
                  hasSouthFacing = true;
                  break;
                }
              }
            }
            
            // Calculate score based on sun hours
            if (sunshineHours < 1300) {
              solarScore = Math.round((sunshineHours / 1300) * 25);
              solarCategory = 'poor';
            } else if (sunshineHours < 1350) {
              solarScore = 25 + Math.round(((sunshineHours - 1300) / 50) * 25);
              solarCategory = 'solid';
            } else if (sunshineHours < 1400) {
              solarScore = 50 + Math.round(((sunshineHours - 1350) / 50) * 25);
              solarCategory = 'good';
            } else {
              solarScore = 75 + Math.min(25, Math.round(((sunshineHours - 1400) / 100) * 25));
              solarCategory = 'great';
            }
          }
          
          // Only include leads with good solar scores
          if (solarCategory !== 'poor') {
            newLeads.push({
              id: generateId(),
              name: result.row.name || 'Unknown',
              address: result.row.address,
              city: result.row.city,
              state: result.row.state,
              zip: result.row.zip,
              phone: result.row.phone,
              email: result.row.email,
              estimatedBill: result.row.estimatedBill,
              lat: result.lat!,
              lng: result.lng!,
              status: 'unclaimed',
              createdAt: new Date(),
              solarScore,
              solarCategory,
              solarMaxPanels: solarData.solarPotential?.maxArrayPanelsCount,
              solarSunshineHours: solarData.solarPotential?.maxSunshineHoursPerYear,
              hasSouthFacingRoof: hasSouthFacing,
              solarTestedAt: new Date(),
            });
          }
          
        } catch (e) {
          logToFile('WARN', 'UploadModal', 'Solar fetch failed', { address: result.row.address, error: e });
          // Still add lead without solar data
          newLeads.push({
            id: generateId(),
            name: result.row.name || 'Unknown',
            address: result.row.address,
            city: result.row.city,
            state: result.row.state,
            zip: result.row.zip,
            phone: result.row.phone,
            email: result.row.email,
            estimatedBill: result.row.estimatedBill,
            lat: result.lat!,
            lng: result.lng!,
            status: 'unclaimed',
            createdAt: new Date(),
          });
        }
        
        // Update progress
        setProgress({ current: rows.length + i + 1, total: rows.length * 2 });
      }

      // Count poor leads (not added)
      const poorCount = geocodedSuccess.length - newLeads.length;
      const failedCount = geocodedFailed.length;

      logToFile('INFO', 'UploadModal', 'Final results', { 
        good: newLeads.length, 
        poor: poorCount, 
        geocodeFailed: failedCount 
      });

      // Save all good leads
      logToFile('INFO', 'UploadModal', 'Saving leads', { count: newLeads.length });
      newLeads.forEach(lead => {
        logToFile('INFO', 'UploadModal', 'Adding lead', { name: lead.name, address: lead.address, score: lead.solarScore });
        addLead(lead);
      });

      // Show failed info
      const failedAddresses = [
        ...geocodedFailed.map(r => `${r.row.address}, ${r.row.city}`),
        ...(poorCount > 0 ? [`${poorCount} leads had poor solar (<1300 hrs)`] : []),
        ...(skippedDuplicates.length > 0 ? [`${skippedDuplicates.length} duplicates skipped (existing leads preserved)`] : [])
      ];
      
      setSuccessCount(newLeads.length);
      setFailedAddresses(failedAddresses.length > 0 ? failedAddresses : []);

      setStep('complete');
      onComplete(newLeads.length);
      
    } catch (err: any) {
      logToFile('ERROR', 'UploadModal', 'Upload failed', { error: err.message, stack: err.stack });
      setError('Failed to process leads. Please try again.');
      setStep('upload');
    }
  };

  const handleClose = () => {
    setFile(null);
    setRows([]);
    setGeocoded([]);
    setProgress({ current: 0, total: 0 });
    setError(null);
    setSuccessCount(0);
    setFailedAddresses([]);
    setStep('upload');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Upload Lead Data
          </h2>
          <button 
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'upload' && (
            <>
              {/* Upload Area */}
              <div 
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <File className="w-8 h-8 text-blue-500" />
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-sm text-gray-500">{rows.length} rows found</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-900 font-medium">Drop your CSV here</p>
                    <p className="text-sm text-gray-500 mt-1">
                      or click to browse
                    </p>
                    <p className="text-xs text-gray-400 mt-3">
                      Required: address, city, state, zip
                    </p>
                  </>
                )}
              </div>

              {/* Error Display */}
              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700 whitespace-pre-line">
                      {error}
                    </p>
                  </div>
                </div>
              )}

              {/* File Info */}
              {rows.length > 0 && !error && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <p className="text-sm text-green-700">
                      {rows.length} valid rows ready to process
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'processing' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-gray-200 rounded-full" />
                <div 
                  className="absolute inset-0 border-4 border-blue-500 rounded-full"
                  style={{
                    borderTopColor: 'transparent',
                    borderRightColor: 'transparent',
                    transform: `rotate(${progress.current / progress.total * 360}deg)`,
                  }}
                />
                <MapPin className="absolute inset-0 m-auto w-6 h-6 text-blue-500" />
              </div>
              
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Geocoding Addresses
              </h3>
              <p className="text-gray-500 mb-4">
                Finding coordinates for {progress.total} addresses...
              </p>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              
              <p className="text-sm text-gray-400 mt-4">
                {progress.current} of {progress.total}
              </p>
            </div>
          )}

          {step === 'complete' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Upload Complete!
              </h3>
              <p className="text-gray-500 mb-6">
                {successCount} leads added to the map
              </p>

              {failedAddresses.length > 0 && (
                <div className="text-left p-4 bg-amber-50 border border-amber-200 rounded-lg mb-6">
                  <p className="text-sm font-medium text-amber-800 mb-2">
                    ⚠️ Skipped addresses:
                  </p>
                  <ul className="text-xs text-amber-700 space-y-1 max-h-32 overflow-y-auto">
                    {failedAddresses.slice(0, 10).map((addr, i) => (
                      <li key={i}>• {addr}</li>
                    ))}
                    {failedAddresses.length > 10 && (
                      <li>...and {failedAddresses.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}

              <button
                onClick={handleClose}
                className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'upload' && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleProcess}
              disabled={rows.length === 0 || !!error}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Process Addresses
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
