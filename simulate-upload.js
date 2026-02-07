// Simulate the upload flow to debug

const fs = require('fs');
const path = require('path');

// Simulate localStorage
const storage = {};
global.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = value.toString(); },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

// Simulate fetch
global.fetch = async (url) => {
  if (url.includes('geocode/json')) {
    const match = url.match(/address=([^&]+)/);
    const address = match ? decodeURIComponent(match[1]) : 'unknown';
    console.log(`🌐 FETCH: ${address}`);

    // Return mock response based on address
    return {
      ok: true,
      json: async () => {
        if (address.includes('Main St')) {
          return { status: 'OK', results: [{ geometry: { location: { lat: 43.1566, lng: -77.6088 } } }] };
        }
        return { status: 'ZERO_RESULTS', results: [] };
      }
    };
  }
  return { ok: true, json: async () => ({}) };
};

async function run() {
  console.log('🧪 Simulating upload flow...\n');

  // Load storage utils
  const storageModule = require('./app/utils/storage');
  const geocodeModule = require('./app/utils/geocode');

  // Test CSV rows
  const testRows = [
    { name: 'John Doe', address: '123 Main St', city: 'Rochester', state: 'NY', zip: '14618', phone: '555-1234', email: 'john@example.com' },
    { name: 'Jane Smith', address: '456 Oak Ave', city: 'Rochester', state: 'NY', zip: '14620', phone: '555-5678', email: 'jane@example.com' },
    { name: 'Bob Wilson', address: '789 Elm St', city: 'Rochester', state: 'NY', zip: '14625', phone: '555-9999', email: 'bob@example.com' },
  ];

  console.log(`📄 Processing ${testRows.length} test rows...\n`);

  // Geocode batch
  console.log('🗺️  Geocoding...');
  const results = await geocodeModule.geocodeBatch(testRows, (current, total) => {
    console.log(`   Progress: ${current}/${total}`);
  });

  console.log('\n📊 Results:');
  results.forEach((r, i) => {
    const status = r.lat && r.lng ? '✅' : '❌';
    console.log(`   ${status} Row ${i+1}: ${r.row.address}, ${r.row.city} (${r.lat ? r.lat.toFixed(4) : 'NO COORDS'})`);
  });

  // Add to storage
  const successful = results.filter(r => r.lat && r.lng);
  console.log(`\n💾 Adding ${successful.length} leads to storage...`);

  successful.forEach(result => {
    const lead = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: result.row.name || 'Unknown',
      address: result.row.address,
      city: result.row.city,
      state: result.row.state,
      zip: result.row.zip,
      phone: result.row.phone,
      email: result.row.email,
      lat: result.lat,
      lng: result.lng,
      status: 'unclaimed',
      createdAt: new Date(),
    };
    storageModule.addLead(lead);
    console.log(`   ✅ Added: ${lead.name} (${lead.address})`);
  });

  // Check storage
  const leads = storageModule.getLeads();
  console.log(`\n📋 Total leads in storage: ${leads.length}`);

  // Check localStorage contents
  console.log('\n🔍 localStorage contents:');
  Object.keys(storage).forEach(key => {
    if (key.includes('happysolar')) {
      console.log(`   ${key}: ${storage[key].substring(0, 100)}...`);
    }
  });

  console.log('\n✅ Simulation complete!');
}

run().catch(console.error);
