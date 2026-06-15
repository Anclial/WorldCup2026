// Backend: Firestore (Google Sheets / Apps Script removed)
export const BACKEND = 'firebase';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCsVF6aGd8-Eb_TMbFvXe2Wzz4Q9niIELs',
  authDomain: 'worldcup2026pickem.firebaseapp.com',
  projectId: 'worldcup2026pickem',
  storageBucket: 'worldcup2026pickem.firebasestorage.app',
  messagingSenderId: '212736296703',
  appId: '1:212736296703:web:d84fca06718b9ac2852eca',
};

export function useFirebaseBackend() {
  return BACKEND === 'firebase';
}

export function isFirebaseConfigured() {
  return !!(FIREBASE_CONFIG?.projectId && FIREBASE_CONFIG?.apiKey);
}
