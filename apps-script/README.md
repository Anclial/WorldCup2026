# Deprecated — Google Sheets backend

This app now uses **Firestore** (`BACKEND = 'firebase'` in `src/config.js`).

`Code.gs` is kept only as a reference for the one-time migration script
(`npm run migrate:firestore`), which copies data from the old Sheets deployment
into Firestore. You can delete the Google Sheet and Apps Script deployment once
migration is complete.
