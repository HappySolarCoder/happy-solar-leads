const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, updateDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBvE0KBM_ceY2gnEIIgg7xRuXDm3V2b9b8",
  authDomain: "gen-lang-client-0395385938.firebaseapp.com",
  projectId: "gen-lang-client-0395385938",
  storageBucket: "gen-lang-client-0395385938.firebasestorage.app",
  messagingSenderId: "1069421766327",
  appId: "1:1069421766327:web:8c5b4eebd16f7f61f9daf9",
  measurementId: "G-GGCNMRMLX6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateUser() {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', 'devinp539@icloud.com'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.log('User not found with email: devinp539@icloud.com');
      process.exit(1);
    }
    
    snapshot.forEach(async (userDoc) => {
      const userRef = doc(db, 'users', userDoc.id);
      await updateDoc(userRef, {
        role: 'manager'
      });
      console.log(`✅ Updated user ${userDoc.id} (${userDoc.data().name}) to manager role`);
      process.exit(0);
    });
  } catch (error) {
    console.error('Error updating user:', error);
    process.exit(1);
  }
}

updateUser();
