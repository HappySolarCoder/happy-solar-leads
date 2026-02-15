// Test script to see ALL fields returned by Google Solar API

const apiKey = 'AIzaSyCVbiweX65EncP7RyF6HZk0Y1_1ZosX_D8';

// Test address (random Rochester address)
const lat = 43.1566;
const lng = -77.6088;

const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    console.log('\n========== GOOGLE SOLAR API FULL RESPONSE ==========\n');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('\n========== TOP LEVEL FIELDS ==========\n');
    console.log(Object.keys(data).join('\n'));
    
    if (data.solarPotential) {
      console.log('\n========== SOLAR POTENTIAL FIELDS ==========\n');
      console.log(Object.keys(data.solarPotential).join('\n'));
    }
    
    if (data.boundingBox) {
      console.log('\n========== BOUNDING BOX FIELDS ==========\n');
      console.log(Object.keys(data.boundingBox).join('\n'));
    }
    
    // Look for any property/building type fields
    console.log('\n========== SEARCHING FOR PROPERTY TYPE... ==========\n');
    const jsonStr = JSON.stringify(data);
    const propertyFields = ['propertyType', 'buildingType', 'structureType', 'dwellingType', 'residentialType', 'apartment', 'commercial'];
    propertyFields.forEach(field => {
      if (jsonStr.includes(field)) {
        console.log(`✓ Found: ${field}`);
      }
    });
    
    console.log('\nDone!');
  })
  .catch(err => {
    console.error('Error:', err.message);
  });
