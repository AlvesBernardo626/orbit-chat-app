// Per-user call volume, remembered across calls (keyed by user id, not by
// call session) so a preference set once for a friend sticks next time.
// Voice and screen-share audio are stored under separate keys — they're
// independent controls (you might want someone's mic quiet but their
// shared video loud, or vice versa).
const VOICE_PREFIX = 'orbit:volume:';
const SHARE_PREFIX = 'orbit:share-volume:';

function getStored(prefix, userId) {
  try {
    const raw = localStorage.getItem(prefix + userId);
    if (raw === null) return 1;
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 1;
  } catch {
    return 1;
  }
}

function setStored(prefix, userId, volume) {
  try {
    localStorage.setItem(prefix + userId, String(volume));
  } catch {
    /* storage unavailable — volume just won't persist */
  }
}

export function getStoredVolume(userId) { return getStored(VOICE_PREFIX, userId); }
export function setStoredVolume(userId, volume) { setStored(VOICE_PREFIX, userId, volume); }

export function getStoredShareVolume(userId) { return getStored(SHARE_PREFIX, userId); }
export function setStoredShareVolume(userId, volume) { setStored(SHARE_PREFIX, userId, volume); }
