// Reset test data - Node.js compatible
// Run: node scripts/reset-data.js

const fs = require('fs');
const path = require('path');

console.log('🗑️  Clearing test data...\n');

// Check for test data files
const testUsersPath = path.join(__dirname, 'test-users.json');
const testLeadsPath = path.join(__dirname, 'test-leads.json');

if (fs.existsSync(testUsersPath)) {
  fs.unlinkSync(testUsersPath);
  console.log('   ✅ Deleted: scripts/test-users.json');
}

if (fs.existsSync(testLeadsPath)) {
  fs.unlinkSync(testLeadsPath);
  console.log('   ✅ Deleted: scripts/test-leads.json');
}

console.log('\n✨ Test data cleared!');
console.log('\n📝 To set up test data, run:');
console.log('   node scripts/generate-test-users.js');
console.log('   node scripts/generate-test-leads.js');
console.log('\nThen copy the import commands to your browser console.');
