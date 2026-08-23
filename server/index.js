const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createDb } = require('./db');
const { PORT, STATUSES } = require('../shared/constants');

const VALID_STATUSES = STATUSES;

function startServer(dbFilePath, { port = PORT, host = '127.0.0.1' } = {}) {
  const db = createDb(dbFilePath);
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  app.get('/health', (req, res) => res.json({ ok: true }));

  /** userId -> Set<socket.id> */
  const presence = new Map();

  function effectiveStatus(user) {
    if (!presence.has(user.id) || presence.get(user.id).size === 0) return 'offline';
    return user.status === 'invisible' ? 'offline' : user.status;
  }

  function broadcastPresence(user) {
    const friends = db.listFriends(user.id);
    const status = effectiveStatus(user);
    friends.forEach((f) => {
      io.to(`user:${f.id}`).emit('presence:update', { userId: user.id, status });
    });
  }

  function broadcastProfile(user) {
    const friends = db.listFriends(user.id);
    const payload = publicUser(user);
    friends.forEach((f) => {
      io.to(`user:${f.id}`).emit('friend:profile', payload);
    });
  }

  function publicUser(user) {
    if (!user) return null;
    const result = {
      id: user.id,
      username: user.username,
      tag: user.tag,
      avatar: user.avatar,
      status: effectiveStatus(user),
      statusMessage: user.statusMessage,
    };
    if (user.friendshipId) result.friendshipId = user.friendshipId;
    return result;
  }

  /** Like publicUser, but keeps the raw chosen status (e.g. "invisible")
   * instead of the effective status shown to others. Used only for the
   * "this is you" payload so your own profile screen reflects your real pick. */
  function selfUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      tag: user.tag,
      avatar: user.avatar,
      status: user.status,
      statusMessage: user.statusMessage,
    };
  }

  io.on('connection', (socket) => {
    let currentUserId = null;

    function joinSession(user) {
      currentUserId = user.id;
      socket.join(`user:${user.id}`);
      if (!presence.has(user.id)) presence.set(user.id, new Set());
      presence.get(user.id).add(socket.id);

      const friends = db.listFriends(user.id).map((f) => publicUser(f));
      const incoming = db.listPendingIncoming(user.id).map((f) => publicUser(f));
      const outgoing = db.listPendingOutgoing(user.id).map((f) => publicUser(f));

      broadcastPresence(user);

      return {
        user: selfUser(user),
        friends,
        incoming,
        outgoing,
      };
    }

    socket.on('register', ({ username }, ack) => {
      const trimmed = String(username || '').trim();
      if (!trimmed) return ack && ack({ error: 'invalid_username' });
      const user = db.createUser(trimmed);
      ack && ack(joinSession(user));
    });

    socket.on('auth', ({ id }, ack) => {
      const user = db.getUserById(id);
      if (!user) return ack && ack({ error: 'not_found' });
      ack && ack(joinSession(user));
    });

    socket.on('profile:update', (patch, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const user = db.updateUserProfile(currentUserId, patch);
      ack && ack({ user: selfUser(user) });
      broadcastProfile(user);
    });

    socket.on('status:update', ({ status }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!VALID_STATUSES.includes(status)) return ack && ack({ error: 'invalid_status' });
      const user = db.updateUserStatus(currentUserId, status);
      ack && ack({ user: selfUser(user) });
      broadcastPresence(user);
    });

    socket.on('friend:request', ({ username, tag }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const result = db.createFriendRequest(currentUserId, String(username || ''), String(tag || ''));
      if (result.error) return ack && ack({ error: result.error });
      const fromUser = db.getUserById(currentUserId);
      io.to(`user:${result.target.id}`).emit('friend:incoming', publicUser(fromUser));
      ack && ack({ ok: true, target: publicUser(result.target) });
    });

    socket.on('friend:respond', ({ friendshipId, accept }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const result = db.respondFriendRequest(friendshipId, currentUserId, !!accept);
      if (result.error) return ack && ack({ error: result.error });
      const { friendship } = result;
      const otherId = friendship
        ? (friendship.userA === currentUserId ? friendship.userB : friendship.userA)
        : null;
      ack && ack({ ok: true });
      if (otherId) {
        const me = db.getUserById(currentUserId);
        const other = db.getUserById(otherId);
        io.to(`user:${currentUserId}`).emit('friend:updated', {});
        io.to(`user:${otherId}`).emit('friend:updated', {});
        if (accept) {
          broadcastPresence(me);
          broadcastPresence(other);
        }
      }
    });

    socket.on('friend:remove', ({ friendId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      db.removeFriend(currentUserId, friendId);
      io.to(`user:${currentUserId}`).emit('friend:updated', {});
      io.to(`user:${friendId}`).emit('friend:updated', {});
      ack && ack({ ok: true });
    });

    socket.on('friends:list', (_payload, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const friends = db.listFriends(currentUserId).map((f) => publicUser(f));
      const incoming = db.listPendingIncoming(currentUserId).map((f) => publicUser(f));
      const outgoing = db.listPendingOutgoing(currentUserId).map((f) => publicUser(f));
      ack && ack({ friends, incoming, outgoing });
    });

    socket.on('message:send', ({ to, text }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!db.areFriends(currentUserId, to)) return ack && ack({ error: 'not_friends' });
      const trimmed = String(text || '').trim();
      if (!trimmed) return ack && ack({ error: 'empty' });
      const message = db.addMessage(currentUserId, to, trimmed);
      ack && ack({ ok: true, message });
      io.to(`user:${to}`).emit('message:receive', message);
    });

    socket.on('messages:history', ({ withUserId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const history = db.getConversation(currentUserId, withUserId);
      ack && ack({ messages: history });
    });

    // --- Call signaling (relay only) ---
    const relay = (event) => (payload, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const { to } = payload;
      if (!db.areFriends(currentUserId, to)) return ack && ack({ error: 'not_friends' });
      io.to(`user:${to}`).emit(event, { ...payload, from: currentUserId });
      ack && ack({ ok: true });
    };

    // call:invite is special-cased: the callee has no prior knowledge of the
    // caller, so call:incoming must carry the caller's full public profile
    // (id/username/tag/avatar), not just a bare id like every other relayed
    // call:* event (whose payload the callee/caller already know how to map
    // back to the peer they started the call with).
    socket.on('call:invite', ({ to }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!db.areFriends(currentUserId, to)) return ack && ack({ error: 'not_friends' });
      const targetOnline = presence.has(to) && presence.get(to).size > 0;
      if (!targetOnline) return ack && ack({ error: 'offline' });
      const caller = db.getUserById(currentUserId);
      io.to(`user:${to}`).emit('call:incoming', publicUser(caller));
      ack && ack({ ok: true });
    });

    socket.on('call:cancel', relay('call:cancelled'));
    socket.on('call:accept', relay('call:accepted'));
    socket.on('call:decline', relay('call:declined'));
    socket.on('call:offer', relay('call:offer'));
    socket.on('call:answer', relay('call:answer'));
    socket.on('call:ice-candidate', relay('call:ice-candidate'));
    socket.on('call:end', relay('call:end'));
    socket.on('screenshare:state', relay('screenshare:state'));

    socket.on('disconnect', () => {
      if (!currentUserId) return;
      const set = presence.get(currentUserId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          presence.delete(currentUserId);
          const user = db.getUserById(currentUserId);
          if (user) broadcastPresence(user);
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', (err) => reject(err));
    httpServer.listen(port, host, () => resolve({ port, host }));
  });
}

module.exports = { startServer, PORT };
