/**
 * Delete all game data from Firestore (players, rosters, results, config).
 * Run: npm run clear:firestore
 */
import { initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  getDocs,
  getFirestore,
  writeBatch,
} from 'firebase/firestore';
import { FIREBASE_CONFIG } from '../src/config.js';

const COLLECTIONS = ['players', 'rosters', 'results', 'config'];

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

async function deleteCollection(name) {
  const snap = await getDocs(collection(db, name));
  if (snap.empty) {
    console.log(`${name}: already empty`);
    return 0;
  }

  let batch = writeBatch(db);
  let ops = 0;
  let total = 0;

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    ops++;
    total++;
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  console.log(`${name}: deleted ${total} document(s)`);
  return total;
}

async function main() {
  console.log('Clearing Firestore collections...');
  let total = 0;
  for (const name of COLLECTIONS) {
    total += await deleteCollection(name);
  }
  console.log(`Done. Removed ${total} document(s) total.`);
}

main().catch((err) => {
  console.error(err);
  if (String(err).includes('PERMISSION_DENIED') || err.code === 'permission-denied') {
    console.error(`
Could not delete — Firestore rules block deletes.

Publish the updated rules in Firebase Console (allows delete for reset scripts):
https://console.firebase.google.com/project/worldcup2026pickem/firestore/rules

Copy the contents of firestore.rules from this repo, click Publish, then run:
  npm run reset:firestore
`);
  }
  process.exit(1);
});
