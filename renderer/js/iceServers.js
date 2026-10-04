import { emit } from './api.js';

// Server-provided STUN/TURN list (TURN credentials are generated server-side).
// Starts as STUN-only so calls still work before the first fetch completes.
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
let refreshTimer = null;

const REFRESH_MS = 4 * 60 * 60 * 1000;

function setIceServers(list) {
  if (Array.isArray(list) && list.length) iceServers = list;
}

function getIceServers() {
  return iceServers;
}

async function refreshIceServers() {
  try {
    const res = await emit('ice:config');
    setIceServers(res && res.iceServers);
  } catch {
    // keep the last known list
  }
}

// Called once logged in: TURN credentials expire, so keep them fresh for
// long-running sessions.
function startIceRefresh(initial) {
  setIceServers(initial);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshIceServers, REFRESH_MS);
}

export { getIceServers, startIceRefresh, refreshIceServers };
