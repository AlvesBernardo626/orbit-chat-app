const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoClient, GridFSBucket } = require('mongodb');

const MAX_GROUP_MEMBERS = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const REPLY_SNIPPET = 160;
const SALT_ROUNDS = 10;
const NO_ID = { projection: { _id: 0 } };

function pickColor(seed) {
  const palettes = [
    ['#22d3c9', '#0e7c86'],
    ['#ff9d5c', '#c2410c'],
    ['#f472b6', '#a3175e'],
    ['#a78bfa', '#5b34c9'],
    ['#fbbf24', '#b45309'],
    ['#60a5fa', '#1d4ed8'],
    ['#34d399', '#047857'],
    ['#fb7185', '#9f1239'],
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length];
}

// Users are persisted permanently in MongoDB Atlas (not the app's local
// filesystem), so accounts survive redeploys of the signaling server and
// restarts/sleeps of the Render instance — only an explicit profile edit
// changes a stored record.
async function createDb(mongoUri) {
  if (!mongoUri) throw new Error('MONGODB_URI não configurada');
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db('orbit');

  const users = db.collection('users');
  const friendships = db.collection('friendships');
  const messages = db.collection('messages');
  const groups = db.collection('groups');
  // Attachments live in GridFS inside the same Atlas database, so they
  // survive Render redeploys (its disk is wiped on every deploy).
  const bucket = new GridFSBucket(db, { bucketName: 'attachments' });
  const fileDocs = db.collection('attachments.files');

  await Promise.all([
    users.createIndex({ usernameLower: 1 }, { unique: true }),
    users.createIndex({ id: 1 }, { unique: true }),
    friendships.createIndex({ id: 1 }, { unique: true }),
    friendships.createIndex({ userA: 1 }),
    friendships.createIndex({ userB: 1 }),
    messages.createIndex({ id: 1 }, { unique: true }),
    messages.createIndex({ from: 1, to: 1 }),
    messages.createIndex({ groupId: 1 }),
    groups.createIndex({ id: 1 }, { unique: true }),
    groups.createIndex({ members: 1 }),
    fileDocs.createIndex({ 'metadata.fileId': 1 }, { unique: true }),
  ]);

  async function generateTag(usernameLower) {
    let tag;
    let exists;
    do {
      tag = String(Math.floor(1 + Math.random() * 9999)).padStart(4, '0');
      exists = await users.findOne({ usernameLower, tag }, NO_ID);
    } while (exists);
    return tag;
  }

  // --- Accounts (username + password) ---
  function validatePassword(password) {
    return typeof password === 'string' && password.length >= 6 && password.length <= 72;
  }

  async function createAccount({ username, password }) {
    const trimmed = String(username || '').trim().slice(0, 24);
    if (trimmed.length < 2) return { error: 'invalid_username' };
    if (!validatePassword(password)) return { error: 'invalid_password' };

    const usernameLower = trimmed.toLowerCase();
    const existing = await users.findOne({ usernameLower }, NO_ID);
    if (existing) return { error: 'username_taken' };

    const tag = await generateTag(usernameLower);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = {
      id: crypto.randomUUID(),
      username: trimmed,
      usernameLower,
      tag,
      passwordHash,
      avatar: { type: 'initials', color: pickColor(trimmed + tag) },
      banner: { type: 'gradient' },
      status: 'online',
      statusMessage: '',
      createdAt: Date.now(),
    };
    try {
      await users.insertOne(user);
    } catch (err) {
      if (err && err.code === 11000) return { error: 'username_taken' };
      throw err;
    }
    delete user._id;
    return { user };
  }

  async function authenticate({ username, password }) {
    const usernameLower = String(username || '').trim().toLowerCase();
    if (!usernameLower || !password) return { error: 'invalid_credentials' };
    const user = await users.findOne({ usernameLower });
    if (!user) return { error: 'invalid_credentials' };
    const ok = await bcrypt.compare(String(password), user.passwordHash || '');
    if (!ok) return { error: 'invalid_credentials' };
    delete user._id;
    return { user };
  }

  async function getUserById(id) {
    const user = await users.findOne({ id }, NO_ID);
    return user || null;
  }

  async function getUserByUsernameTag(username, tag) {
    const usernameLower = String(username || '').trim().toLowerCase();
    const user = await users.findOne({ usernameLower, tag }, NO_ID);
    return user || null;
  }

  async function updateUserProfile(id, { avatar, banner, statusMessage, username, tag, profileColor }) {
    const current = await getUserById(id);
    if (!current) return { error: 'not_found' };
    const patch = {};
    if (avatar !== undefined) patch.avatar = avatar;
    if (banner !== undefined) patch.banner = banner;
    if (statusMessage !== undefined) patch.statusMessage = String(statusMessage).slice(0, 140);
    if (username !== undefined) patch.username = String(username).trim().slice(0, 24);
    if (profileColor !== undefined) {
      if (profileColor !== null && !/^#[0-9a-f]{6}$/i.test(String(profileColor))) return { error: 'invalid_color' };
      patch.profileColor = profileColor;
    }

    let paddedTag = current.tag;
    if (tag !== undefined) {
      const cleanTag = String(tag).trim();
      if (!/^\d{1,4}$/.test(cleanTag)) return { error: 'invalid_tag' };
      paddedTag = cleanTag.padStart(4, '0');
      patch.tag = paddedTag;
    }

    if (patch.username !== undefined) {
      const finalUsernameLower = patch.username.toLowerCase();
      if (finalUsernameLower !== current.usernameLower) {
        const clash = await users.findOne({ id: { $ne: id }, usernameLower: finalUsernameLower }, NO_ID);
        if (clash) return { error: 'username_taken' };
      }
      patch.usernameLower = finalUsernameLower;
    }

    await users.updateOne({ id }, { $set: patch });
    return { user: await getUserById(id) };
  }

  async function updateUserStatus(id, status) {
    await users.updateOne({ id }, { $set: { status } });
    return getUserById(id);
  }

  async function friendshipBetween(userIdA, userIdB) {
    return friendships.findOne({
      $or: [
        { userA: userIdA, userB: userIdB },
        { userA: userIdB, userB: userIdA },
      ],
    }, NO_ID);
  }

  async function createFriendRequest(fromId, toUsername, toTag) {
    const target = await getUserByUsernameTag(toUsername, toTag);
    if (!target) return { error: 'not_found' };
    if (target.id === fromId) return { error: 'self' };
    const existing = await friendshipBetween(fromId, target.id);
    if (existing) {
      return { error: existing.status === 'accepted' ? 'already_friends' : 'already_pending' };
    }
    const friendship = {
      id: crypto.randomUUID(),
      userA: fromId,
      userB: target.id,
      requestedBy: fromId,
      status: 'pending',
      createdAt: Date.now(),
    };
    await friendships.insertOne(friendship);
    delete friendship._id;
    return { friendship, target };
  }

  async function respondFriendRequest(friendshipId, userId, accept) {
    const friendship = await friendships.findOne({ id: friendshipId }, NO_ID);
    if (!friendship) return { error: 'not_found' };
    if (friendship.userB !== userId && friendship.userA !== userId) return { error: 'forbidden' };
    if (friendship.requestedBy === userId) return { error: 'forbidden' };
    if (accept) {
      await friendships.updateOne({ id: friendshipId }, { $set: { status: 'accepted' } });
    } else {
      await friendships.deleteOne({ id: friendshipId });
    }
    return { friendship: await friendships.findOne({ id: friendshipId }, NO_ID) };
  }

  async function removeFriend(userId, friendId) {
    await friendships.deleteMany({
      $or: [
        { userA: userId, userB: friendId },
        { userA: friendId, userB: userId },
      ],
    });
  }

  async function listFriends(userId) {
    const rows = await friendships.find({
      status: 'accepted',
      $or: [{ userA: userId }, { userB: userId }],
    }, NO_ID).toArray();
    const others = await Promise.all(rows.map(async (f) => {
      const otherId = f.userA === userId ? f.userB : f.userA;
      const other = await getUserById(otherId);
      return other ? { ...other, friendshipId: f.id } : null;
    }));
    return others.filter(Boolean);
  }

  async function listPendingIncoming(userId) {
    const rows = await friendships.find({
      status: 'pending',
      requestedBy: { $ne: userId },
      $or: [{ userA: userId }, { userB: userId }],
    }, NO_ID).toArray();
    const others = await Promise.all(rows.map(async (f) => {
      const otherId = f.userA === userId ? f.userB : f.userA;
      const other = await getUserById(otherId);
      return other ? { ...other, friendshipId: f.id } : null;
    }));
    return others.filter(Boolean);
  }

  async function listPendingOutgoing(userId) {
    const rows = await friendships.find({ status: 'pending', requestedBy: userId }, NO_ID).toArray();
    const others = await Promise.all(rows.map(async (f) => {
      const otherId = f.userA === userId ? f.userB : f.userA;
      const other = await getUserById(otherId);
      return other ? { ...other, friendshipId: f.id } : null;
    }));
    return others.filter(Boolean);
  }

  async function areFriends(userIdA, userIdB) {
    const f = await friendshipBetween(userIdA, userIdB);
    return !!(f && f.status === 'accepted');
  }

  // --- Attachments ---
  async function saveFile(uploaderId, { name, type, data }) {
    if (!Buffer.isBuffer(data) || data.length === 0) return { error: 'invalid_file' };
    if (data.length > MAX_FILE_BYTES) return { error: 'too_large' };
    const fileId = crypto.randomBytes(16).toString('hex');
    const meta = {
      id: fileId,
      name: String(name || 'arquivo').slice(0, 180),
      type: String(type || 'application/octet-stream').slice(0, 100),
      size: data.length,
    };
    await new Promise((resolve, reject) => {
      const upload = bucket.openUploadStream(meta.name, {
        metadata: { fileId, uploaderId, type: meta.type, size: meta.size, createdAt: Date.now() },
      });
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(data);
    });
    return { file: meta };
  }

  async function getFile(fileId) {
    const doc = await fileDocs.findOne({ 'metadata.fileId': String(fileId) });
    if (!doc) return null;
    return {
      name: doc.filename,
      type: doc.metadata.type,
      size: doc.length,
      stream: () => bucket.openDownloadStream(doc._id),
    };
  }

  // Only files the sender uploaded themselves can be attached to a message.
  async function resolveAttachments(uploaderId, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const wanted = [...new Set(ids.map(String))].slice(0, MAX_ATTACHMENTS);
    const docs = await fileDocs.find({ 'metadata.fileId': { $in: wanted }, 'metadata.uploaderId': uploaderId }).toArray();
    const byId = new Map(docs.map((d) => [d.metadata.fileId, d]));
    return wanted.filter((id) => byId.has(id)).map((id) => {
      const d = byId.get(id);
      return { id, name: d.filename, type: d.metadata.type, size: d.length };
    });
  }

  async function deleteFiles(fileIds) {
    if (!fileIds.length) return;
    const docs = await fileDocs.find({ 'metadata.fileId': { $in: fileIds } }, { projection: { _id: 1 } }).toArray();
    await Promise.all(docs.map((d) => bucket.delete(d._id).catch(() => {})));
  }

  // --- Messages (DMs and groups share one collection) ---
  // A reply stores a small snapshot of the original, so it still reads fine
  // even if the original is edited later.
  async function buildReply(replyToId, scope) {
    if (!replyToId) return null;
    const original = await messages.findOne({ id: String(replyToId), ...scope }, NO_ID);
    if (!original) return null;
    return {
      id: original.id,
      from: original.from,
      text: String(original.text || '').slice(0, REPLY_SNIPPET),
      attachmentCount: (original.attachments || []).length,
    };
  }

  function dmScope(userIdA, userIdB) {
    return { $or: [{ from: userIdA, to: userIdB }, { from: userIdB, to: userIdA }] };
  }

  async function createMessage(base, scope, { text, replyToId, attachmentIds, mentions, mentionAll }) {
    const attachments = await resolveAttachments(base.from, attachmentIds);
    const trimmed = String(text || '').trim().slice(0, 4000);
    if (!trimmed && attachments.length === 0) return { error: 'empty' };
    const message = {
      id: crypto.randomUUID(),
      ...base,
      text: trimmed,
      createdAt: Date.now(),
    };
    const replyTo = await buildReply(replyToId, scope);
    if (replyTo) message.replyTo = replyTo;
    if (attachments.length) message.attachments = attachments;
    if (mentions && mentions.length) message.mentions = mentions;
    if (mentionAll) message.mentionAll = true;
    await messages.insertOne(message);
    delete message._id;
    return { message };
  }

  async function addMessage(fromId, toId, content) {
    return createMessage({ from: fromId, to: toId }, dmScope(fromId, toId), content);
  }

  async function getConversation(userIdA, userIdB, limit = 200) {
    const all = await messages.find(dmScope(userIdA, userIdB), NO_ID).sort({ createdAt: 1 }).toArray();
    return all.slice(-limit);
  }

  async function lastMessageWith(userIdA, userIdB) {
    const conv = await getConversation(userIdA, userIdB, 1);
    return conv[conv.length - 1] || null;
  }

  async function getMessage(id) {
    return messages.findOne({ id: String(id) }, NO_ID);
  }

  // Shared by DM and group messages — both live in the same collection,
  // distinguished only by having `to` vs `groupId` set.
  async function editMessage(id, userId, text, { mentions, mentionAll } = {}) {
    const message = await messages.findOne({ id }, NO_ID);
    if (!message) return { error: 'not_found' };
    if (message.from !== userId) return { error: 'forbidden' };
    const trimmed = String(text || '').trim().slice(0, 4000);
    if (!trimmed && !(message.attachments || []).length) return { error: 'empty' };
    const set = { text: trimmed, editedAt: Date.now(), mentions: mentions || [], mentionAll: !!mentionAll };
    await messages.updateOne({ id }, { $set: set });
    return { message: await messages.findOne({ id }, NO_ID) };
  }

  async function createGroup(creatorId, name, memberIds) {
    const uniqueMembers = [...new Set(memberIds)];
    if (uniqueMembers.length < 2) return { error: 'need_more_members' };
    if (uniqueMembers.length > MAX_GROUP_MEMBERS) return { error: 'too_many_members' };
    const id = crypto.randomUUID();
    const group = {
      id,
      name: (name && name.trim().slice(0, 40)) || 'Novo grupo',
      icon: { type: 'initials', color: pickColor(id) },
      members: uniqueMembers,
      createdBy: creatorId,
      createdAt: Date.now(),
    };
    await groups.insertOne(group);
    delete group._id;
    return { group };
  }

  async function getGroupById(id) {
    return groups.findOne({ id }, NO_ID);
  }

  async function isGroupMember(groupId, userId) {
    const group = await getGroupById(groupId);
    return !!(group && group.members.includes(userId));
  }

  async function updateGroup(id, { name, icon }) {
    const patch = {};
    if (name !== undefined) patch.name = name.trim().slice(0, 40) || 'Novo grupo';
    if (icon !== undefined) patch.icon = icon;
    await groups.updateOne({ id }, { $set: patch });
    return getGroupById(id);
  }

  async function addGroupMembers(groupId, newMemberIds) {
    const group = await getGroupById(groupId);
    if (!group) return { error: 'not_found' };
    const merged = [...new Set([...group.members, ...newMemberIds])];
    if (merged.length > MAX_GROUP_MEMBERS) return { error: 'too_many_members' };
    await groups.updateOne({ id: groupId }, { $set: { members: merged } });
    return { group: await getGroupById(groupId) };
  }

  async function listGroupsForUser(userId) {
    return groups.find({ members: userId }, NO_ID).toArray();
  }

  async function addGroupMessage(groupId, fromId, content) {
    return createMessage({ groupId, from: fromId }, { groupId }, content);
  }

  async function getGroupConversation(groupId, limit = 200) {
    const all = await messages.find({ groupId }, NO_ID).sort({ createdAt: 1 }).toArray();
    return all.slice(-limit);
  }

  // Only the group's creator can delete it — any member can leave the
  // conversation view aside, but wiping it for everyone else is scoped to
  // whoever made it, same as most chat apps.
  async function deleteGroup(groupId, userId) {
    const group = await getGroupById(groupId);
    if (!group) return { error: 'not_found' };
    if (group.createdBy !== userId) return { error: 'forbidden' };
    const withFiles = await messages.find({ groupId, attachments: { $exists: true } }, NO_ID).toArray();
    await groups.deleteOne({ id: groupId });
    await messages.deleteMany({ groupId });
    await deleteFiles(withFiles.flatMap((m) => m.attachments.map((a) => a.id)));
    return { group };
  }

  return {
    createAccount,
    authenticate,
    getUserById,
    getUserByUsernameTag,
    updateUserProfile,
    updateUserStatus,
    createFriendRequest,
    respondFriendRequest,
    removeFriend,
    listFriends,
    listPendingIncoming,
    listPendingOutgoing,
    areFriends,
    saveFile,
    getFile,
    getMessage,
    addMessage,
    getConversation,
    lastMessageWith,
    editMessage,
    createGroup,
    getGroupById,
    isGroupMember,
    updateGroup,
    addGroupMembers,
    listGroupsForUser,
    addGroupMessage,
    getGroupConversation,
    deleteGroup,
  };
}

module.exports = { createDb, MAX_GROUP_MEMBERS, MAX_FILE_BYTES };
