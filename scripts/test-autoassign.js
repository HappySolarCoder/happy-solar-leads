// Test the auto-assignment algorithm

const users = JSON.parse(localStorage.getItem('happysolar_users') || '[]');
const leads = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');

console.log('🧪 Testing Auto-Assignment\n');
console.log('='.repeat(50));

// Filter users with home addresses
const setters = users.filter(u => u.homeLat && u.homeLng && u.status === 'active');
console.log(`\n📊 Users with home addresses: ${setters.length}`);
setters.forEach(u => {
  console.log(`   ${u.name}: ${u.homeLat.toFixed(4)}, ${u.homeLng.toFixed(4)}`);
});

// Filter leads with coordinates
const assignableLeads = leads.filter(l => l.lat && l.lng && l.status === 'unclaimed' && l.solarCategory !== 'poor');
console.log(`\n📊 Assignable leads: ${assignableLeads.length}`);

// Haversine distance function
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Simple assignment (closest setter to each lead)
const assignments = {};
setters.forEach(u => assignments[u.id] = []);

assignableLeads.forEach(lead => {
  let closestSetter = null;
  let closestDistance = Infinity;
  
  setters.forEach(setter => {
    const distance = calculateDistance(
      lead.lat, lead.lng,
      setter.homeLat, setter.homeLng
    );
    
    if (distance < closestDistance) {
      closestDistance = distance;
      closestSetter = setter;
    }
  });
  
  if (closestSetter) {
    assignments[closestSetter.id].push({
      name: lead.name,
      address: `${lead.address}, ${lead.city}`,
      distance: closestDistance.toFixed(1),
    });
  }
});

console.log('\n📋 Assignment Results:');
console.log('-'.repeat(50));

Object.entries(assignments).forEach(([userId, assigned]) => {
  const user = setters.find(u => u.id === userId);
  if (!user) return;
  
  console.log(`\n👤 ${user.name}:`);
  console.log(`   Assigned: ${assigned.length} leads`);
  if (assigned.length > 0) {
    assigned.forEach((lead, i) => {
      console.log(`   ${i + 1}. ${lead.name} (${lead.distance} mi)`);
    });
  }
});

console.log('\n' + '='.repeat(50));
console.log('✅ Test complete!');
console.log('\n💡 To apply these assignments in the app:');
console.log('   1. Open the app');
console.log('   2. Go to http://localhost:3000');
console.log('   3. Click "Auto-Assign" button');
console.log('   4. The app will assign leads based on proximity');
