const { adminAuth, adminDb } = require('./app/utils/firebase-admin');

async function createTestUser() {
  const email = 'test-manager@raydar.com';
  const password = 'test123';

  try {
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: 'Test Manager',
    });

    await adminDb.collection('users').doc(userRecord.uid).set({
      id: userRecord.uid,
      name: 'Test Manager',
      email,
      color: '#ef4444',
      role: 'manager',
      createdAt: new Date(),
      isActive: true,
    });

    console.log('✅ Test manager created:', userRecord.uid);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createTestUser();
