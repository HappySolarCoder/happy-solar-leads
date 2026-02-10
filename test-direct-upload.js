// Direct upload test bypassing the file picker

async function testDirectUpload() {
  console.log('🧪 Testing direct upload to production...\n');
  
  const csvContent = `name,address,city,state,zip,phone,email,estimatedBill
Test Lead 1,1600 Amphitheatre Parkway,Mountain View,CA,94043,555-0001,test1@example.com,250
Test Lead 2,1 Apple Park Way,Cupertino,CA,95014,555-0002,test2@example.com,300
Test Lead 3,1 Infinite Loop,Cupertino,CA,95014,555-0003,test3@example.com,275`;

  // Parse CSV
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i];
    });
    return row;
  });
  
  console.log(`📝 Parsed ${rows.length} rows from CSV\n`);
  
  // Step 1: Geocode
  console.log('📍 Geocoding addresses...');
  const geocoded = [];
  
  for (const row of rows) {
    const address = `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
    console.log(`  - ${row.name}: ${address}`);
    
    try {
      const res = await fetch('https://happy-solar-leads.vercel.app/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      
      if (res.ok) {
        const data = await res.json();
        geocoded.push({
          ...row,
          lat: data.lat,
          lng: data.lng
        });
        console.log(`    ✅ ${data.lat}, ${data.lng}`);
      } else {
        console.log(`    ❌ Failed: ${res.status}`);
      }
    } catch (err) {
      console.log(`    ❌ Error: ${err.message}`);
    }
  }
  
  console.log(`\n✅ Geocoded ${geocoded.length}/${rows.length}\n`);
  
  // Step 2: Solar data
  console.log('☀️  Fetching solar data...');
  const withSolar = [];
  
  for (const lead of geocoded) {
    console.log(`  - ${lead.name}`);
    
    try {
      const res = await fetch('https://happy-solar-leads.vercel.app/api/solar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lead.lat, lng: lead.lng })
      });
      
      if (res.ok) {
        const data = await res.json();
        const hours = data.solarPotential?.maxSunshineHoursPerYear || 0;
        const panels = data.solarPotential?.maxArrayPanelsCount || 0;
        
        let solarScore = 0;
        let solarCategory = 'poor';
        
        if (hours < 1300) {
          solarScore = Math.round((hours / 1300) * 25);
          solarCategory = 'poor';
        } else if (hours < 1350) {
          solarScore = 25 + Math.round(((hours - 1300) / 50) * 25);
          solarCategory = 'solid';
        } else if (hours < 1400) {
          solarScore = 50 + Math.round(((hours - 1350) / 50) * 25);
          solarCategory = 'good';
        } else {
          solarScore = 75 + Math.min(25, Math.round(((hours - 1400) / 100) * 25));
          solarCategory = 'great';
        }
        
        withSolar.push({
          id: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: lead.name,
          address: lead.address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          phone: lead.phone,
          email: lead.email,
          estimatedBill: parseFloat(lead.estimatedBill) || 0,
          lat: lead.lat,
          lng: lead.lng,
          status: 'unclaimed',
          createdAt: new Date().toISOString(),
          solarScore,
          solarCategory,
          solarMaxPanels: panels,
          solarSunshineHours: hours,
          hasSouthFacingRoof: true,
          solarTestedAt: new Date().toISOString()
        });
        
        console.log(`    ✅ ${hours.toFixed(0)} hrs/yr, ${panels} panels, ${solarCategory}`);
      } else {
        console.log(`    ⚠️  Solar failed`);
        withSolar.push({
          id: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ...lead,
          status: 'unclaimed',
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.log(`    ⚠️  Error: ${err.message}`);
    }
  }
  
  console.log(`\n💾 Processed ${withSolar.length} leads\n`);
  
  // Results
  console.log('📊 RESULTS:');
  console.log(`   Geocoded: ${geocoded.length}/${rows.length}`);
  console.log(`   With solar: ${withSolar.length}`);
  console.log(`   Success rate: ${((withSolar.length / rows.length) * 100).toFixed(0)}%`);
  
  if (withSolar.length > 0) {
    console.log('\n✅ APIs Working - leads ready to save to localStorage');
    console.log('Sample lead:');
    console.log(JSON.stringify(withSolar[0], null, 2));
  } else {
    console.log('\n❌ Upload flow failed');
  }
}

testDirectUpload();
