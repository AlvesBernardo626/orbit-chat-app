// Per-user call volume, remembered across calls (keyed by user id, not by
// call session) so a preference set once for a friend sticks next time.
const KEY_PREFIX = 'orbit:volume:';

export function getStoredVolume(userId) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (raw === null) return 1;
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 1;
  } catch {
    return 1;
  }
}

export function setStoredVolume(userId, volume) {
  try {
    localStorage.setItem(KEY_PREFIX + userId, String(volume));
  } catch {
    /* storage unavailable — volume just won't persist */
  }
}
