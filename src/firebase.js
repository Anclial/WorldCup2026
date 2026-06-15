import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG, isFirebaseConfigured } from './config.js';

let app = null;
let db = null;

export function getDb() {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Check FIREBASE_CONFIG in src/config.js.');
  }
  if (!db) {
    app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
  }
  return db;
}
