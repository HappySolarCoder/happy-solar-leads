// Generate test leads with UNIQUE coordinates - Node.js compatible
// Run: node scripts/generate-test-leads.js

const fs = require('fs');
const path = require('path');

const addresses = [
  { street: 'Main St', city: 'Rochester', state: 'NY', zip: '14604', lat: 43.1566, lng: -77.6088 },
  { street: 'Elm St', city: 'Rochester', state: 'NY', zip: '14605', lat: 43.1577, lng: -77.6105 },
  { street: 'Oak Ave', city: 'Rochester', state: 'NY', zip: '14606', lat: 43.1588, lng: -77.6123 },
  { street: 'Pine Rd', city: 'Rochester', state: 'NY', zip: '14607', lat: 43.1599, lng: -77.6141 },
  { street: 'Maple Dr', city: 'Rochester', state: 'NY', zip: '14608', lat: 43.1610, lng: -77.6159 },
  { street: 'Cedar Ln', city: 'Rochester', state: 'NY', zip: '14609', lat: 43.1621, lng: -77.6177 },
  { street: 'Birch St', city: 'Rochester', state: 'NY', zip: '14610', lat: 43.1632, lng: -77.6195 },
  { street: 'Willow Ave', city: 'Rochester', state: 'NY', zip: '14611', lat: 43.1643, lng: -77.6213 },
  { street: 'Spruce Rd', city: 'Rochester', state: 'NY', zip: '14612', lat: 43.1654, lng: -77.6231 },
  { street: 'Ash Dr', city: 'Rochester', state: 'NY', zip: '14613', lat: 43.1665, lng: -77.6249 },
  { street: 'Elm St', city: 'Henrietta', state: 'NY', zip: '14467', lat: 43.0520, lng: -77.6100 },
  { street: 'Oak St', city: 'Henrietta', state: 'NY', zip: '14467', lat: 43.0535, lng: -77.6122 },
  { street: 'Pine Ave', city: 'Henrietta', state: 'NY', zip: '14467', lat: 43.0550, lng: -77.6144 },
  { street: 'Maple Rd', city: 'Henrietta', state: 'NY', zip: '14467', lat: 43.0565, lng: -77.6166 },
  { street: 'Cedar Ln', city: 'Pittsford', state: 'NY', zip: '14534', lat: 43.0914, lng: -77.5156 },
  { street: 'Birch St', city: 'Pittsford', state: 'NY', zip: '14534', lat: 43.0932, lng: -77.5180 },
  { street: 'Willow Dr', city: 'Pittsford', state: 'NY', zip: '14534', lat: 43.0950, lng: -77.5204 },
  { street: 'Spruce Ave', city: 'Brighton', state: 'NY', zip: '14618', lat: 43.1280, lng: -77.5700 },
  { street: 'Ash Rd', city: 'Brighton', state: 'NY', zip: '14618', lat: 43.1300, lng: -77.5725 },
  { street: 'Chestnut St', city: 'Brighton', state: 'NY', zip: '14618', lat: 43.1320, lng: -77.5750 },
];

const firstNames = ['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emily', 'Chris', 'Lisa', 'Tom', 'Amy'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Track used coordinates to ensure uniqueness
const usedCoords = new Set();

const generateLeads = (count) => {
  const leads = [];
  let id = 0;
  
  while (leads.length < count) {
    const addr = randomItem(addresses);
    
    // Add small random offset to ensure unique coordinates
    const latOffset = (Math.random() - 0.5) * 0.002; // ~500ft variation
    const lngOffset = (Math.random() - 0.5) * 0.002;
    
    const lat = parseFloat((addr.lat + latOffset).toFixed(7));
    const lng = parseFloat((addr.lng + lngOffset).toFixed(7));
    const coordKey = `${lat},${lng}`;
    
    // Skip if this coordinate already used
    if (usedCoords.has(coordKey)) {
      continue;
    }
    usedCoords.add(coordKey);
    
    // Solar score
    const rand = Math.random();
    let solarScore, solarCategory;
    if (rand < 0.1) {
      solarScore = Math.floor(Math.random() * 25);
      solarCategory = 'poor';
    } else if (rand < 0.3) {
      solarScore = 25 + Math.floor(Math.random() * 25);
      solarCategory = 'solid';
    } else if (rand < 0.6) {
      solarScore = 50 + Math.floor(Math.random() * 25);
      solarCategory = 'good';
    } else {
      solarScore = 75 + Math.floor(Math.random() * 25);
      solarCategory = 'great';
    }
    
    leads.push({
      id: `test-${Date.now()}-${id++}`,
      name: `${randomItem(firstNames)} ${randomItem(lastNames)}`,
      address: `${Math.floor(Math.random() * 9000 + 100)} ${addr.street}`,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      phone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
      estimatedBill: Math.floor(Math.random() * 200 + 50),
      lat,
      lng,
      status: 'unclaimed',
      solarScore,
      solarCategory,
      solarSunshineHours: 1200 + Math.floor(Math.random() * 300),
      solarMaxPanels: Math.floor(Math.random() * 30 + 10),
      hasSouthFacing: Math.random() > 0.3,
      createdAt: new Date().toISOString(),
    });
  }
  
  return leads;
};

const leads = generateLeads(50);

// Save to JSON file
const outputPath = path.join(__dirname, '..', 'scripts', 'test-leads.json');
fs.writeFileSync(outputPath, JSON.stringify(leads, null, 2));

console.log(`✅ Generated ${leads.length} test leads with UNIQUE coordinates`);
console.log(`📊 Saved to: scripts/test-leads.json`);

// Categories summary
const categories = leads.reduce((acc, l) => {
  acc[l.solarCategory] = (acc[l.solarCategory] || 0) + 1;
  return acc;
}, {});
console.log('\n☀️ Solar categories:');
Object.entries(categories).forEach(([cat, count]) => {
  console.log(`   ${cat}: ${count}`);
});

// Unique check
const uniqueCoords = new Set(leads.map(l => `${l.lat},${l.lng}`));
console.log(`\n📍 Unique coordinates: ${uniqueCoords.size}/${leads.length}`);

console.log('\n📋 Import command for browser console:');
console.log('---');
console.log(`localStorage.setItem('happysolar_leads', JSON.stringify(${JSON.stringify(leads)}));`);
console.log('---');
console.log('\nThen refresh the page!');
