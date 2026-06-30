import * as firestoreApi from './firestore-api.js';

export function fetchBracketGames() {
  return firestoreApi.fetchBracketGames();
}

export function fetchAppData() {
  return firestoreApi.fetchAppData();
}

export function syncScoresInBackground() {
  return firestoreApi.syncScoresInBackground();
}

export function fetchData() {
  return firestoreApi.fetchData();
}

export function join(name, circle, options) {
  return firestoreApi.join(name, circle, options);
}

export function submitRoster(playerId, teamIds) {
  return firestoreApi.submitRoster(playerId, teamIds);
}
