const https = require('https');

const key = 'AIzaSyCVbiweX65EncP7RyF6HZk0Y1_1ZosX_D8'; // From .env.local

const testRoute = async () => {
  console.log('Testing Google Routes API...\n');

  const requestBody = {
    origin: { address: 'Rochester, NY' },
    destination: { address: 'Henrietta, NY' },
    intermediates: [
      { location: { latLng: { latitude: 43.0884, longitude: -77.6758 } } }
    ],
    travelMode: 'DRIVE',
    // departureTime removed - causes timestamp sync issues
  };

  console.log('Request:', JSON.stringify(requestBody, null, 2));

  const url = new URL(`https://routes.googleapis.com/directions/v2:computeRoutes?key=${key}`);

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': '*',
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('\nResponse status:', res.statusCode);
      console.log('Response:', data);
    });
  });

  req.on('error', (e) => {
    console.error('Error:', e.message);
  });

  req.write(JSON.stringify(requestBody));
  req.end();
};

testRoute();
