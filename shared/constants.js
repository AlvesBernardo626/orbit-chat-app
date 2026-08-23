const PORT = 4732;

// Local dev default: the embedded local server. For the build that goes out
// to friends, this gets swapped to the hosted server's https:// URL before
// running `npm run dist` (see BUILD.md) — every copy of the app then talks
// to that one shared server instead of trying to host its own.
const SERVER_URL = `http://localhost:${PORT}`;

const IS_REMOTE_SERVER = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(SERVER_URL);

module.exports = {
  PORT,
  SERVER_URL,
  IS_REMOTE_SERVER,
  STATUSES: ['online', 'away', 'dnd', 'invisible'],
};
