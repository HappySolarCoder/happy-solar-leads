// Script to inject test leads into localStorage on production site
// Run this in the browser console at https://happy-solar-leads-1d2n.vercel.app

const testLeads = [
  {
    id: `lead-${Date.now()}-1`,
    name: 'Google HQ',
    address: '1600 Amphitheatre Parkway',
    city: 'Mountain View',
    state: 'CA',
    zip: '94043',
    lat: 37.4223724,
    lng: -122.0854877,
    phone: '555-0001',
    email: 'test1@example.com',
    estimatedBill: 250,
    status: 'unclaimed',
    createdAt: new Date().toISOString(),
    solarScore: 85,
    solarCategory: 'great',
    solarMaxPanels: 947,
    solarSunshineHours: 1779.4,
    hasSouthFacingRoof: true,
    solarTestedAt: new Date().toISOString()
  },
  {
    id: `lead-${Date.now()}-2`,
    name: 'Apple Park',
    address: '1 Apple Park Way',
    city: 'Cupertino',
    state: 'CA',
    zip: '95014',
    lat: 37.3293903,
    lng: -122.0084062,
    phone: '555-0002',
    email: 'test2@example.com',
    estimatedBill: 300,
    status: 'unclaimed',
    createdAt: new Date().toISOString(),
    solarScore: 90,
    solarCategory: 'great',
    solarMaxPanels: 61,
    solarSunshineHours: 1861.4,
    hasSouthFacingRoof: true,
    solarTestedAt: new Date().toISOString()
  },
  {
    id: `lead-${Date.now()}-3`,
    name: 'Apple Infinite Loop',
    address: '1 Infinite Loop',
    city: 'Cupertino',
    state: 'CA',
    zip: '95014',
    lat: 37.3318598,
    lng: -122.0302485,
    phone: '555-0003',
    email: 'test3@example.com',
    estimatedBill: 275,
    status: 'unclaimed',
    createdAt: new Date().toISOString(),
    solarScore: 95,
    solarCategory: 'great',
    solarMaxPanels: 1998,
    solarSunshineHours: 1966.4,
    hasSouthFacingRoof: true,
    solarTestedAt: new Date().toISOString()
  }
];

// Get existing leads
const existing = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');

// Add test leads
const allLeads = [...existing, ...testLeads];

// Save to localStorage
localStorage.setItem('happysolar_leads', JSON.stringify(allLeads));

console.log(`✅ Added ${testLeads.length} test leads to localStorage`);
console.log(`📊 Total leads: ${allLeads.length}`);
console.log('\n🔄 Reload the page to see them on the map!');
