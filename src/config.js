// Backend: 'apps-script' (Google Sheets) or 'firebase' (Firestore)
export const BACKEND = 'apps-script';

// Google Apps Script — used when BACKEND is 'apps-script'
export const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbziEyAjSZTSBehzFzpSnait0DDsyyg42qDgiCGzI1MP5mIu0lzt1N3nezij8RjB5nYP/exec';

export const SHEET_ID = '1hP3GiaeaMfaokbmm9nJDy8T9ZtF_y7oaljRZgxuX-48';

// Firebase — from Firebase Console → Project settings → Your apps → Web app
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

export function isAppsScriptConfigured() {
  return (
    APPS_SCRIPT_URL &&
    !APPS_SCRIPT_URL.includes('YOUR_ID') &&
    APPS_SCRIPT_URL.includes('script.google.com/macros/s/') &&
    APPS_SCRIPT_URL.endsWith('/exec')
  );
}

export function isFirebaseConfigured() {
  return !!(FIREBASE_CONFIG?.projectId && FIREBASE_CONFIG?.apiKey);
}
