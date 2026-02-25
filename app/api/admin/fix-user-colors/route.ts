import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebaseAdmin';
import { getDefaultUserColor } from '@/app/utils/userColors';

const BRIGHT_COLORS = [
  '#FF0000', '#00FFFF', '#FF00FF', '#FFFF00', '#00FF00', '#FF6600',
  '#FF0099', '#0099FF', '#FF3366', '#00FF99', '#9966FF', '#FF9900',
  '#FF33CC', '#33CCFF', '#CCFF00', '#FF3333', '#33FF33', '#3399FF',
  '#FF6699', '#66FF33', '#FF9933', '#9933FF', '#33FFCC', '#FFCC00',
  '#FF0066', '#66CCFF', '#CCFF33', '#FF3399', '#33FF99', '#FF6633',
];

export async function POST() {
  try {
    if (!adminDb) {
      throw new Error('Firestore Admin not initialized');
    }

    const usersSnapshot = await adminDb().collection('users').get();
    
    let updated = 0;
    let index = 0;
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const currentColor = userData.color?.toUpperCase();
      
      // Check if color is in bright palette
      const isValidColor = currentColor && BRIGHT_COLORS.includes(currentColor);
      
      if (!isValidColor) {
        const newColor = getDefaultUserColor(index);
        await adminDb().collection('users').doc(userDoc.id).update({
          color: newColor,
        });
        
        console.log(`Updated ${userData.name}: ${userData.color} → ${newColor}`);
        updated++;
      }
      
      index++;
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updated} user colors to bright palette`,
      totalUsers: usersSnapshot.size,
      updated,
    });
  } catch (error: any) {
    console.error('Error fixing user colors:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
