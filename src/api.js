import { useFirebaseBackend } from './config.js';
import * as appsScriptApi from './apps-script-api.js';
import * as firestoreApi from './firestore-api.js';

const api = {
  get fetchData() {
    return useFirebaseBackend() ? firestoreApi.fetchData : appsScriptApi.fetchData;
  },
  get join() {
    return useFirebaseBackend() ? firestoreApi.join : appsScriptApi.join;
  },
  get submitRoster() {
    return useFirebaseBackend() ? firestoreApi.submitRoster : appsScriptApi.submitRoster;
  },
};

export function fetchData() {
  return api.fetchData();
}

export function join(name, circle) {
  return api.join(name, circle);
}

export function submitRoster(playerId, teamIds) {
  return api.submitRoster(playerId, teamIds);
}
