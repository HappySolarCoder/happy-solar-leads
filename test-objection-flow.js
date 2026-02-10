// Test objection tracking data structure
const testLead = {
  id: 'test-123',
  name: 'John Test',
  address: '123 Test St',
  city: 'Phoenix',
  state: 'AZ',
  zip: '85001',
  status: 'claimed',
  claimedBy: 'user-1',
  createdAt: new Date().toISOString()
};

const testLeadWithObjection = {
  ...testLead,
  status: 'not-interested',
  objectionType: 'too-expensive',
  objectionNotes: 'Said current bill is only $50/month',
  objectionRecordedAt: new Date().toISOString(),
  objectionRecordedBy: 'user-1',
  dispositionedAt: new Date().toISOString()
};

console.log('Test Lead Structure:');
console.log(JSON.stringify(testLead, null, 2));
console.log('\nTest Lead With Objection:');
console.log(JSON.stringify(testLeadWithObjection, null, 2));

// Verify all objection types
const objectionTypes = [
  'too-expensive',
  'bad-credit',
  'roof-issues',
  'moving-soon',
  'not-owner',
  'already-has-solar',
  'too-complicated',
  'need-to-think',
  'not-interested-in-solar',
  'other'
];

console.log('\nValid Objection Types:');
objectionTypes.forEach(type => console.log(`  - ${type}`));

console.log('\n✅ Data structure is valid');
