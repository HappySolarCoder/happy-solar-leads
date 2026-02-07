// CSV parsing utility

import Papa from 'papaparse';
import { CSVRow } from '@/app/types';

export function parseCSV(file: File): Promise<CSVRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: CSVRow[] = [];
        
        for (const row of results.data as Record<string, string>[]) {
          // Normalize field names (case-insensitive matching)
          const normalized: Record<string, string> = {};
          
          for (const [key, value] of Object.entries(row)) {
            const lowerKey = key.toLowerCase().trim();
            normalized[lowerKey] = value?.trim() || '';
          }
          
          // Map common field names to our schema
          const csvRow: CSVRow = {
            name: normalized.name || normalized.fullname || normalized['full name'] || 
                  (normalized.firstname || normalized['first name'] ? 
                    `${normalized.firstname || normalized['first name']} ${normalized.lastname || normalized['last name'] || ''}`.trim() 
                    : ''),
            address: normalized.address || normalized.street || '',
            city: normalized.city || '',
            state: normalized.state || '',
            zip: normalized.zip || normalized.zipcode || '',
            phone: normalized.phone || normalized.telephone || normalized['phone number'] || '',
            email: normalized.email || normalized['email address'] || '',
          };
          
          // Only add if it has at least an address
          if (csvRow.address) {
            rows.push(csvRow);
          }
        }
        
        resolve(rows);
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

export function validateCSV(rows: CSVRow[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    if (!row.address) {
      errors.push(`Row ${i + 2}: Missing address`);
    }
    
    if (!row.city) {
      errors.push(`Row ${i + 2}: Missing city`);
    }
    
    if (!row.state) {
      errors.push(`Row ${i + 2}: Missing state`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
