// Quick test of the geocode API
async function testGeocode() {
  try {
    const response = await fetch('http://localhost:3000/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '1600 Amphitheatre Parkway, Mountain View, CA 94043' })
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data.lat && data.lng) {
      console.log('\n✅ Geocode API working! Got coordinates:', data.lat, data.lng);
    } else {
      console.log('\n❌ Geocode failed:', data.error || 'Unknown error');
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
}

testGeocode();
