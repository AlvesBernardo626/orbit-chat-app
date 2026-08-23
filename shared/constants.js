const PORT = 4732;

// Points at the hosted signaling server (see BUILD.md) so every friend's
// copy of the distributed .exe talks to that one shared server instead of
// trying to host its own. Set back to `http://localhost:${PORT}` for local
// dev against the embedded server.
const SERVER_URL = 'https://orbit-signaling.onrender.com';

const IS_REMOTE_SERVER = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(SERVER_URL);

module.exports = {
  PORT,
  SERVER_URL,
  IS_REMOTE_SERVER,
  STATUSES: ['online', 'away', 'dnd', 'invisible'],
};
