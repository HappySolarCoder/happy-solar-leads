// Quick test to verify Firestore connection
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBvE0KBM_ceY2gnEIIgg7xRuXDm3V2b9b8",
  authDomain: "gen-lang-client-0395385938.firebaseapp.com",
  projectId: "gen-lang-client-0395385938",
  storageBucket: "gen-lang-client-0395385938.firebasestorage.app",
  messagingSenderId: "143988544112",
  appId: "1:143988544112:web:f5ff6e296b62521f969ab5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testWrite() {
  try {
    console.log('Testing Firestore connection...');
    const docRef = await addDoc(collection(db, 'test'), {
      message: 'Hello from Boris!',
      timestamp: new Date()
    });
    console.log('✅ SUCCESS! Document written with ID:', docRef.id);
    console.log('Check Firebase Console now!');
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }
  process.exit(0);
}

testWrite();
