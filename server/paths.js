// Users, friendships, messages and groups now live permanently in MongoDB
// Atlas (see atlas-credentials.env, not committed) instead of a local JSON
// file, so a Render redeploy/restart never wipes accounts anymore.
const MONGODB_URI = process.env.MONGODB_URI || '';

module.exports = { MONGODB_URI };
