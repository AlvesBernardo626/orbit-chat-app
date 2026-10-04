// Builds the ICE server list (STUN + TURN) handed to clients after login.
// TURN credentials live only on the server so they never ship inside the
// installer. Two providers are supported, picked by environment variables:
//
//   Cloudflare Realtime TURN (recommended, free up to 1 TB/month):
//     CF_TURN_KEY_ID, CF_TURN_API_TOKEN
//
//   Any static TURN server (e.g. a self-hosted coturn):
//     TURN_URLS (comma separated), TURN_USERNAME, TURN_CREDENTIAL
//
// With neither set, clients only get public STUN (direct P2P only).

const STUN_ONLY = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

const CF_TTL_SECONDS = 24 * 60 * 60;
// Regenerate well before expiry so a fresh login always gets hours of validity.
const CF_REFRESH_MS = 6 * 60 * 60 * 1000;

let cache = null; // { iceServers, fetchedAt }
let inflight = null;

async function fetchCloudflare(keyId, apiToken) {
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CF_TTL_SECONDS }),
    }
  );
  if (!res.ok) throw new Error(`Cloudflare TURN respondeu ${res.status}`);
  const data = await res.json();
  const servers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  // Browsers ignore port 53 and Cloudflare includes it; drop it to avoid console noise.
  return servers.map((s) => ({
    ...s,
    urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
  }));
}

function staticTurn() {
  const urls = (process.env.TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return null;
  return [{ urls, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' }];
}

async function getIceServers() {
  const { CF_TURN_KEY_ID, CF_TURN_API_TOKEN } = process.env;
  if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) {
    const turn = staticTurn();
    return turn ? [...STUN_ONLY, ...turn] : STUN_ONLY;
  }

  if (cache && Date.now() - cache.fetchedAt < CF_REFRESH_MS) return cache.iceServers;
  if (!inflight) {
    inflight = fetchCloudflare(CF_TURN_KEY_ID, CF_TURN_API_TOKEN)
      .then((iceServers) => {
        cache = { iceServers, fetchedAt: Date.now() };
        return iceServers;
      })
      .catch((err) => {
        console.error('[orbit] Falha ao gerar credenciais TURN:', err.message);
        return cache ? cache.iceServers : STUN_ONLY;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function turnMode() {
  if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) return 'cloudflare';
  if (process.env.TURN_URLS) return 'static';
  return 'stun-only';
}

module.exports = { getIceServers, turnMode };
