import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG, useFirebaseBackend } from './config.js';

let app = null;
let db = null;

export function getDb() {
  if (!useFirebaseBackend()) {
    throw new Error('Firebase backend is not enabled. Set BACKEND to "firebase" in src/config.js.');
  }
  if (!db) {
    app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
  }
  return db;
}
