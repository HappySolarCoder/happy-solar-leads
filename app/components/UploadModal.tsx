'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, File, X, MapPin, CheckCircle, AlertCircle, Tag } from 'lucide-react';
import { CSVRow, Lead, LeadTag, LEAD_TAG_LABELS, LEAD_TAG_COLORS, LEAD_TAG_DESCRIPTIONS } from '@/app/types';
import { parseCSV, validateCSV } from '@/app/utils/csv';
import { geocodeBatch } from '@/app/utils/geocode';
import { saveLeadAsync, batchSaveLeadsAsync, getLeadsAsync, generateId } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { canManageUsers } from '@/app/types';

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
  const [selectedTags, setSelectedTags] = useState<LeadTag[]>([]);
  const [excludeApartments, setExcludeApartments] = useState(true); // Filter out apartments by default
  const [isAdmin, setIsAdmin] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if user is admin on mount
  useEffect(() => {
    async function checkAdmin() {
      try {
        const user = await getCurrentAuthUser();
        setIsAdmin(user ? canManageUsers(user.role) : false);
      } catch (error) {
        console.error('Failed to check admin status:', error);
        setIsAdmin(false);
      }
    }
    if (isOpen) {
      checkAdmin();
    }
  }, [isOpen]);

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
      
      // Load existing leads from Firestore to check for duplicates
      const existingLeads = await getLeadsAsync();
      
      // Create a map for faster lookup (address -> lead)
      const existingLeadsMap = new Map<string, Lead>();
      existingLeads.forEach(lead => {
        const normalizedAddress = `${lead.address.toLowerCase().trim()}, ${lead.city.toLowerCase().trim()}, ${lead.state.toLowerCase().trim()} ${lead.zip}`;
        existingLeadsMap.set(normalizedAddress, lead);
      });
      
      for (let i = 0; i < geocodedSuccess.length; i++) {
        const result = geocodedSuccess[i];
        
        // Skip apartments if filter is enabled
        if (excludeApartments && result.propertyType === 'apartment') {
          logToFile('INFO', 'UploadModal', 'Skipping apartment', { address: result.row.address });
          skippedDuplicates.push(`${result.row.address} (apartment)`);
          continue;
        }
        
        // Check for duplicate address
        const normalizedAddress = `${result.row.address?.toLowerCase().trim()}, ${result.row.city?.toLowerCase().trim()}, ${result.row.state?.toLowerCase().trim()} ${result.row.zip}`;
        const existingLead = existingLeadsMap.get(normalizedAddress);
        
        // Determine if we should skip this lead based on tags
        // RULE: solar-data always wins! If new lead will have solar-data tag, it should update/replace existing
        const newLeadWillHaveSolarDataTag = selectedTags.includes('solar-data');
        const existingHasSolarDataTag = existingLead?.tags?.includes('solar-data');
        
        if (existingLead) {
          // Case 1: Existing has solar-data, new doesn't → SKIP (preserve solar-data)
          if (existingHasSolarDataTag && !newLeadWillHaveSolarDataTag) {
            logToFile('INFO', 'UploadModal', 'Skipping duplicate - existing has solar-data', { address: result.row.address });
            skippedDuplicates.push(result.row.address || 'Unknown');
            continue;
          }
          
          // Case 2: New has solar-data, existing doesn't → Will UPDATE (processed below)
          // Case 3: Both have solar-data or neither → SKIP (preserve existing)
          if (!newLeadWillHaveSolarDataTag || (existingHasSolarDataTag && newLeadWillHaveSolarDataTag)) {
            logToFile('INFO', 'UploadModal', 'Skipping duplicate - preserving existing', { address: result.row.address });
            skippedDuplicates.push(result.row.address || 'Unknown');
            continue;
          }
          
          // If we get here: new has solar-data, existing doesn't → will UPDATE below
          logToFile('INFO', 'UploadModal', 'Upgrading existing lead to solar-data', { address: result.row.address });
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
            // If updating existing lead, preserve some fields
            const leadData: any = existingLead ? {
              ...existingLead, // Preserve existing data
              // Update with new solar data
              solarScore,
              solarCategory,
              hasSouthFacingRoof: hasSouthFacing,
              solarTestedAt: new Date(),
              propertyType: result.propertyType || 'unknown', // Update property type
            } : {
              // New lead
              id: generateId(),
              name: result.row.name || 'Unknown',
              address: result.row.address,
              city: result.row.city,
              state: result.row.state,
              zip: result.row.zip,
              lat: result.lat!,
              lng: result.lng!,
              status: 'unclaimed',
              createdAt: new Date(),
              solarScore,
              solarCategory,
              hasSouthFacingRoof: hasSouthFacing,
              solarTestedAt: new Date(),
              propertyType: result.propertyType || 'unknown', // From geocoding API
            };
            
            // Only add optional fields if they exist (for new leads) or update them (for existing)
            if (!existingLead) {
              // New lead - only add if provided in CSV
              if (result.row.phone) leadData.phone = result.row.phone;
              if (result.row.email) leadData.email = result.row.email;
              if (result.row.estimatedBill) leadData.estimatedBill = result.row.estimatedBill;
            }
            // For both new and existing: update tags and solar data
            if (selectedTags.length > 0) leadData.tags = selectedTags;
            if (solarData.solarPotential?.maxArrayPanelsCount) {
              leadData.solarMaxPanels = solarData.solarPotential.maxArrayPanelsCount;
            }
            if (solarData.solarPotential?.maxSunshineHoursPerYear) {
              leadData.solarSunshineHours = solarData.solarPotential.maxSunshineHoursPerYear;
            }
            
            newLeads.push(leadData as Lead);
          }
          
        } catch (e) {
          logToFile('WARN', 'UploadModal', 'Solar fetch failed', { address: result.row.address, error: e });
          
          // If this was going to be an update (upgrade to solar-data), skip it
          // We don't want to upgrade without solar data
          if (existingLead) {
            logToFile('WARN', 'UploadModal', 'Skipping update - solar fetch failed', { address: result.row.address });
            skippedDuplicates.push(result.row.address || 'Unknown');
            continue;
          }
          
          // Still add NEW lead without solar data (clean undefined fields)
          const leadData: any = {
            id: generateId(),
            name: result.row.name || 'Unknown',
            address: result.row.address,
            city: result.row.city,
            state: result.row.state,
            zip: result.row.zip,
            lat: result.lat!,
            lng: result.lng!,
            status: 'unclaimed',
            createdAt: new Date(),
          };
          
          // Only add optional fields if they exist
          if (result.row.phone) leadData.phone = result.row.phone;
          if (result.row.email) leadData.email = result.row.email;
          if (result.row.estimatedBill) leadData.estimatedBill = result.row.estimatedBill;
          if (selectedTags.length > 0) leadData.tags = selectedTags;
          
          newLeads.push(leadData as Lead);
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

      // Save all good leads to Firestore in batches
      logToFile('INFO', 'UploadModal', 'Saving leads to Firestore', { count: newLeads.length });
      
      await batchSaveLeadsAsync(newLeads, (saved, total) => {
        // Update progress during save
        const percentageSaved = Math.round((saved / total) * 100);
        setProgress({ 
          current: rows.length * 2 + saved, 
          total: rows.length * 2 + total 
        });
        console.log(`[UploadModal] Saved ${saved}/${total} leads (${percentageSaved}%)`);
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
    setSelectedTags([]);
    setExcludeApartments(true); // Reset to default (exclude apartments)
    setStep('upload');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
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

              {/* Tag Selection - Admin Only */}
              {isAdmin && rows.length > 0 && !error && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="w-5 h-5 text-gray-700" />
                    <label className="text-sm font-semibold text-gray-900">
                      Lead Tags (Optional)
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Tag these leads for reporting and analytics
                  </p>
                  <div className="space-y-2">
                    {(['solar-data', 'homeowner', 'home-data'] as LeadTag[]).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          if (selectedTags.includes(tag)) {
                            setSelectedTags(selectedTags.filter(t => t !== tag));
                          } else {
                            setSelectedTags([...selectedTags, tag]);
                          }
                        }}
                        className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-left ${
                          selectedTags.includes(tag)
                            ? 'border-blue-500 bg-gradient-to-r from-blue-50 to-blue-50/50 shadow-sm'
                            : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <div
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                              selectedTags.includes(tag)
                                ? 'bg-gradient-to-br from-blue-500 to-blue-600 border-blue-600'
                                : 'border-gray-300 bg-white'
                            }`}
                          >
                            {selectedTags.includes(tag) && (
                              <CheckCircle className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                            )}
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`font-semibold ${selectedTags.includes(tag) ? 'text-blue-900' : 'text-gray-900'}`}>
                              {LEAD_TAG_LABELS[tag]}
                            </span>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: LEAD_TAG_COLORS[tag] }}
                            />
                          </div>
                          <p className={`text-xs ${selectedTags.includes(tag) ? 'text-blue-700' : 'text-gray-500'}`}>
                            {LEAD_TAG_DESCRIPTIONS[tag]}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Apartment Filter */}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setExcludeApartments(!excludeApartments)}
                  className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-left ${
                    excludeApartments
                      ? 'border-orange-500 bg-gradient-to-r from-orange-50 to-orange-50/50 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                        excludeApartments
                          ? 'bg-gradient-to-br from-orange-500 to-orange-600 border-orange-600'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {excludeApartments && (
                        <CheckCircle className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-semibold ${excludeApartments ? 'text-orange-900' : 'text-gray-900'}`}>
                        🏢 Exclude Apartments
                      </span>
                    </div>
                    <p className={`text-xs ${excludeApartments ? 'text-orange-700' : 'text-gray-500'}`}>
                      Automatically filter out apartment units (multi-family dwellings) and only process single-family homes
                    </p>
                  </div>
                </button>
              </div>

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
                Processing Leads
              </h3>
              <p className="text-gray-500 mb-4">
                Geocoding {rows.length} addresses & fetching solar data...
              </p>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              
              <p className="text-sm text-gray-400 mt-4">
                {Math.round((progress.current / progress.total) * 100)}% complete
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
