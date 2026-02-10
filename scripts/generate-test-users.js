// Generate test users - Node.js compatible
// Run: node scripts/generate-test-users.js

const fs = require('fs');
const path = require('path');

const users = [
  {
    id: 'user-test-1',
    email: 'john@test.com',
    name: 'John Smith',
    role: 'setter',
    status: 'active',
    color: '#3b82f6',
    homeAddress: '24 Hawkstone Way, Pittsford, NY 14534',
    homeLat: 43.0914,
    homeLng: -77.5156,
    assignedLeadCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  },
  {
    id: 'user-test-2',
    email: 'jane@test.com',
    name: 'Jane Doe',
    role: 'setter',
    status: 'active',
    color: '#10b981',
    homeAddress: '100 Main St, Rochester, NY 14604',
    homeLat: 43.1566,
    homeLng: -77.6088,
    assignedLeadCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  },
  {
    id: 'user-test-3',
    email: 'mike@test.com',
    name: 'Mike Johnson',
    role: 'setter',
    status: 'active',
    color: '#f59e0b',
    homeAddress: '50 Oak Ave, Henrietta, NY 14467',
    homeLat: 43.0520,
    homeLng: -77.6100,
    assignedLeadCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  },
  {
    id: 'user-test-4',
    email: 'sarah@test.com',
    name: 'Sarah Wilson',
    role: 'setter',
    status: 'active',
    color: '#8b5cf6',
    homeAddress: '200 Brighton Henrietta Rd, Brighton, NY 14618',
    homeLat: 43.1280,
    homeLng: -77.5700,
    assignedLeadCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  },
  {
    id: 'user-admin',
    email: 'evan@test.com',
    name: 'Evan Day',
    role: 'admin',
    status: 'active',
    color: '#ef4444',
    homeAddress: '500 University Ave, Rochester, NY 14607',
    homeLat: 43.1280,
    homeLng: -77.5900,
    assignedLeadCount: 0,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  },
];

// Save to a JSON file that can be imported
const outputPath = path.join(__dirname, '..', 'scripts', 'test-users.json');
fs.writeFileSync(outputPath, JSON.stringify(users, null, 2));

console.log('✅ Created test users JSON at: scripts/test-users.json');
console.log('\n📋 Copy this to browser console to import:');
console.log('---');
console.log(`localStorage.setItem('happysolar_users', JSON.stringify(${JSON.stringify(users)}));`);
console.log('localStorage.setItem(\'happysolar_currentUser\', JSON.stringify(' + JSON.stringify(users[0]) + '));');
console.log('---');
console.log('\nThen refresh the page!');
