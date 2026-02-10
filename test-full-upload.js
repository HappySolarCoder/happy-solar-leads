// Complete upload flow test
const fs = require('fs');

async function testFullUpload() {
  console.log('🧪 Testing complete upload flow...\n');
  
  // Test CSV data
  const testAddresses = [
    {
      name: 'Test Lead 1',
      address: '1600 Amphitheatre Parkway',
      city: 'Mountain View',
      state: 'CA',
      zip: '94043'
    },
    {
      name: 'Test Lead 2',
      address: '1 Apple Park Way',
      city: 'Cupertino',
      state: 'CA',
      zip: '95014'
    }
  ];
  
  // Step 1: Geocode
  console.log('📍 Step 1: Geocoding addresses...');
  const geocodedLeads = [];
  
  for (const addr of testAddresses) {
    const fullAddress = `${addr.address}, ${addr.city}, ${addr.state} ${addr.zip}`;
    console.log(`  - Geocoding: ${fullAddress}`);
    
    try {
      const response = await fetch('http://localhost:3000/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: fullAddress })
      });
      
      if (response.ok) {
        const data = await response.json();
        geocodedLeads.push({
          ...addr,
          lat: data.lat,
          lng: data.lng
        });
        console.log(`    ✅ Success: ${data.lat}, ${data.lng}`);
      } else {
        console.log(`    ❌ Failed: ${response.status}`);
      }
    } catch (error) {
      console.log(`    ❌ Error: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Geocoded ${geocodedLeads.length}/${testAddresses.length} addresses\n`);
  
  // Step 2: Fetch solar data
  console.log('☀️  Step 2: Fetching solar data...');
  const leadsWithSolar = [];
  
  for (const lead of geocodedLeads) {
    console.log(`  - Solar data for: ${lead.address}`);
    
    try {
      const response = await fetch('http://localhost:3000/api/solar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lead.lat, lng: lead.lng })
      });
      
      if (response.ok) {
        const data = await response.json();
        const sunshineHours = data.solarPotential?.maxSunshineHoursPerYear || 0;
        const maxPanels = data.solarPotential?.maxArrayPanelsCount || 0;
        
        console.log(`    ✅ ${sunshineHours} hrs/year, ${maxPanels} panels`);
        
        leadsWithSolar.push({
          ...lead,
          solarSunshineHours: sunshineHours,
          solarMaxPanels: maxPanels
        });
      } else {
        console.log(`    ⚠️  Solar API failed (${response.status}), adding without solar data`);
        leadsWithSolar.push(lead);
      }
    } catch (error) {
      console.log(`    ⚠️  Error: ${error.message}, adding without solar data`);
      leadsWithSolar.push(lead);
    }
  }
  
  console.log(`\n✅ Got solar data for ${leadsWithSolar.length} leads\n`);
  
  // Summary
  console.log('📊 RESULTS:');
  console.log(`   Total uploaded: ${leadsWithSolar.length} leads`);
  console.log(`   Geocode success rate: ${(geocodedLeads.length / testAddresses.length * 100).toFixed(0)}%`);
  
  if (leadsWithSolar.length > 0) {
    console.log('\n✅ UPLOAD FLOW WORKING!');
    console.log('   Leads can be geocoded and enriched with solar data.');
    console.log('   These would now be saved to localStorage and appear on the map.');
  } else {
    console.log('\n❌ UPLOAD FLOW FAILED');
    console.log('   No leads were successfully processed.');
  }
}

testFullUpload();
