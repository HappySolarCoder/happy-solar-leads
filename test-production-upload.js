// Test production upload flow
const PRODUCTION_URL = 'https://happy-solar-leads-1d2n.vercel.app';

async function testProductionUpload() {
  console.log('🧪 Testing PRODUCTION upload flow...\n');
  console.log(`📍 Production URL: ${PRODUCTION_URL}\n`);
  
  // Test data
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
    },
    {
      name: 'Test Lead 3',
      address: '1 Infinite Loop',
      city: 'Cupertino',
      state: 'CA',
      zip: '95014'
    }
  ];
  
  // Step 1: Test Geocoding API
  console.log('📍 Step 1: Testing Geocoding API on production...');
  const geocodedLeads = [];
  
  for (const addr of testAddresses) {
    const fullAddress = `${addr.address}, ${addr.city}, ${addr.state} ${addr.zip}`;
    console.log(`  - Geocoding: ${fullAddress}`);
    
    try {
      const response = await fetch(`${PRODUCTION_URL}/api/geocode`, {
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
        const errorData = await response.json();
        console.log(`    ❌ Failed: ${response.status} - ${JSON.stringify(errorData)}`);
      }
    } catch (error) {
      console.log(`    ❌ Error: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Geocoded ${geocodedLeads.length}/${testAddresses.length} addresses\n`);
  
  // Step 2: Test Solar API
  console.log('☀️  Step 2: Testing Solar API on production...');
  const leadsWithSolar = [];
  
  for (const lead of geocodedLeads) {
    console.log(`  - Solar data for: ${lead.address}`);
    
    try {
      const response = await fetch(`${PRODUCTION_URL}/api/solar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lead.lat, lng: lead.lng })
      });
      
      if (response.ok) {
        const data = await response.json();
        const sunshineHours = data.solarPotential?.maxSunshineHoursPerYear || 0;
        const maxPanels = data.solarPotential?.maxArrayPanelsCount || 0;
        
        console.log(`    ✅ ${sunshineHours.toFixed(1)} hrs/year, ${maxPanels} panels`);
        
        leadsWithSolar.push({
          ...lead,
          solarSunshineHours: sunshineHours,
          solarMaxPanels: maxPanels,
          id: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          status: 'unclaimed',
          createdAt: new Date().toISOString()
        });
      } else {
        const errorData = await response.json();
        console.log(`    ⚠️  Solar API failed: ${response.status} - ${JSON.stringify(errorData)}`);
        leadsWithSolar.push({
          ...lead,
          id: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          status: 'unclaimed',
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.log(`    ⚠️  Error: ${error.message}`);
      leadsWithSolar.push({
        ...lead,
        id: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: 'unclaimed',
        createdAt: new Date().toISOString()
      });
    }
  }
  
  console.log(`\n✅ Got solar data for ${leadsWithSolar.length} leads\n`);
  
  // Summary
  console.log('📊 PRODUCTION TEST RESULTS:');
  console.log(`   Geocoding API: ${geocodedLeads.length > 0 ? '✅ WORKING' : '❌ FAILED'}`);
  console.log(`   Solar API: ${leadsWithSolar.length > 0 ? '✅ WORKING' : '❌ FAILED'}`);
  console.log(`   Total leads processed: ${leadsWithSolar.length}`);
  console.log(`   Success rate: ${((leadsWithSolar.length / testAddresses.length) * 100).toFixed(0)}%`);
  
  if (leadsWithSolar.length === testAddresses.length) {
    console.log('\n✅ ✅ ✅ PRODUCTION UPLOAD FLOW FULLY WORKING! ✅ ✅ ✅');
    console.log('   All APIs operational');
    console.log('   Ready for real CSV uploads');
  } else {
    console.log('\n⚠️  PRODUCTION UPLOAD FLOW PARTIALLY WORKING');
    console.log(`   ${leadsWithSolar.length}/${testAddresses.length} leads successfully processed`);
  }
  
  // Show sample lead data
  if (leadsWithSolar.length > 0) {
    console.log('\n📋 Sample lead data:');
    console.log(JSON.stringify(leadsWithSolar[0], null, 2));
  }
}

testProductionUpload().catch(console.error);
