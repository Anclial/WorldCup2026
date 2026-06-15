import * as firestoreApi from './firestore-api.js';

export function fetchData() {
  return firestoreApi.fetchData();
}

export function join(name, circle) {
  return firestoreApi.join(name, circle);
}

export function submitRoster(playerId, teamIds) {
  return firestoreApi.submitRoster(playerId, teamIds);
}
