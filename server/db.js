const path = require('path');
const crypto = require('crypto');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

function createDb(dbFilePath) {
  const adapter = new FileSync(dbFilePath);
  const db = low(adapter);
  db.defaults({ users: [], friendships: [], messages: [] }).write();

  function generateTag(username) {
    const usernameLower = username.toLowerCase();
    let tag;
    let exists;
    do {
      tag = String(Math.floor(1 + Math.random() * 9999)).padStart(4, '0');
      exists = db.get('users')
        .find((u) => u.username.toLowerCase() === usernameLower && u.tag === tag)
        .value();
    } while (exists);
    return tag;
  }

  function createUser(username) {
    const trimmed = username.trim().slice(0, 24);
    const tag = generateTag(trimmed);
    const user = {
      id: crypto.randomUUID(),
      username: trimmed,
      tag,
      avatar: { type: 'initials', color: pickColor(trimmed + tag) },
      status: 'online',
      statusMessage: '',
      createdAt: Date.now(),
    };
    db.get('users').push(user).write();
    return user;
  }

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

  function getUserById(id) {
    return db.get('users').find({ id }).value();
  }

  function getUserByUsernameTag(username, tag) {
    const usernameLower = username.toLowerCase();
    return db.get('users')
      .find((u) => u.username.toLowerCase() === usernameLower && u.tag === tag)
      .value();
  }

  function updateUserProfile(id, { avatar, statusMessage, username }) {
    const patch = {};
    if (avatar !== undefined) patch.avatar = avatar;
    if (statusMessage !== undefined) patch.statusMessage = statusMessage;
    if (username !== undefined) patch.username = username.trim().slice(0, 24);
    db.get('users').find({ id }).assign(patch).write();
    return getUserById(id);
  }

  function updateUserStatus(id, status) {
    db.get('users').find({ id }).assign({ status }).write();
    return getUserById(id);
  }

  function friendshipBetween(userIdA, userIdB) {
    return db.get('friendships')
      .find((f) => (f.userA === userIdA && f.userB === userIdB) || (f.userA === userIdB && f.userB === userIdA))
      .value();
  }

  function createFriendRequest(fromId, toUsername, toTag) {
    const target = getUserByUsernameTag(toUsername, toTag);
    if (!target) return { error: 'not_found' };
    if (target.id === fromId) return { error: 'self' };
    const existing = friendshipBetween(fromId, target.id);
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
    db.get('friendships').push(friendship).write();
    return { friendship, target };
  }

  function respondFriendRequest(friendshipId, userId, accept) {
    const friendship = db.get('friendships').find({ id: friendshipId }).value();
    if (!friendship) return { error: 'not_found' };
    if (friendship.userB !== userId && friendship.userA !== userId) return { error: 'forbidden' };
    if (friendship.requestedBy === userId) return { error: 'forbidden' };
    if (accept) {
      db.get('friendships').find({ id: friendshipId }).assign({ status: 'accepted' }).write();
    } else {
      db.get('friendships').remove({ id: friendshipId }).write();
    }
    return { friendship: db.get('friendships').find({ id: friendshipId }).value() };
  }

  function removeFriend(userId, friendId) {
    db.get('friendships')
      .remove((f) => (f.userA === userId && f.userB === friendId) || (f.userA === friendId && f.userB === userId))
      .write();
  }

  function listFriends(userId) {
    const friendships = db.get('friendships')
      .filter((f) => f.status === 'accepted' && (f.userA === userId || f.userB === userId))
      .value();
    return friendships.map((f) => {
      const otherId = f.userA === userId ? f.userB : f.userA;
      const other = getUserById(otherId);
      return other ? { ...other, friendshipId: f.id } : null;
    }).filter(Boolean);
  }

  function listPendingIncoming(userId) {
    const friendships = db.get('friendships')
      .filter((f) => f.status === 'pending' && f.requestedBy !== userId && (f.userA === userId || f.userB === userId))
      .value();
    return friendships.map((f) => {
      const otherId = f.userA === userId ? f.userB : f.userA;
      const other = getUserById(otherId);
      return other ? { ...other, friendshipId: f.id } : null;
    }).filter(Boolean);
  }

  function listPendingOutgoing(userId) {
    const friendships = db.get('friendships')
      .filter((f) => f.status === 'pending' && f.requestedBy === userId)
      .value();
    return friendships.map((f) => {
      const otherId = f.userA === userId ? f.userB : f.userA;
      const other = getUserById(otherId);
      return other ? { ...other, friendshipId: f.id } : null;
    }).filter(Boolean);
  }

  function areFriends(userIdA, userIdB) {
    const f = friendshipBetween(userIdA, userIdB);
    return !!(f && f.status === 'accepted');
  }

  function addMessage(fromId, toId, text) {
    const message = {
      id: crypto.randomUUID(),
      from: fromId,
      to: toId,
      text: String(text).slice(0, 4000),
      createdAt: Date.now(),
    };
    db.get('messages').push(message).write();
    return message;
  }

  function getConversation(userIdA, userIdB, limit = 200) {
    const all = db.get('messages')
      .filter((m) => (m.from === userIdA && m.to === userIdB) || (m.from === userIdB && m.to === userIdA))
      .value();
    return all.slice(-limit);
  }

  function lastMessageWith(userIdA, userIdB) {
    const conv = getConversation(userIdA, userIdB, 1);
    return conv[conv.length - 1] || null;
  }

  return {
    createUser,
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
    addMessage,
    getConversation,
    lastMessageWith,
  };
}

module.exports = { createDb };
