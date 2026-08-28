const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createDb } = require('./db');
const { PORT, STATUSES } = require('../shared/constants');

const VALID_STATUSES = STATUSES;

async function startServer(mongoUri, { port = PORT, host = '127.0.0.1' } = {}) {
  const db = await createDb(mongoUri);
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

  async function broadcastPresence(user) {
    const friends = await db.listFriends(user.id);
    const status = effectiveStatus(user);
    friends.forEach((f) => {
      io.to(`user:${f.id}`).emit('presence:update', { userId: user.id, status });
    });
  }

  async function broadcastProfile(user) {
    const friends = await db.listFriends(user.id);
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
      banner: user.banner,
      status: effectiveStatus(user),
      statusMessage: user.statusMessage,
      createdAt: user.createdAt,
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
      banner: user.banner,
      status: user.status,
      statusMessage: user.statusMessage,
      createdAt: user.createdAt,
    };
  }

  /** groupId -> Set<userId> currently connected to that group's active call */
  const groupCallParticipants = new Map();

  function activeCallMemberIds(groupId) {
    return groupCallParticipants.has(groupId) ? [...groupCallParticipants.get(groupId)] : [];
  }

  async function publicGroup(group) {
    if (!group) return null;
    const members = await Promise.all(group.members.map((id) => db.getUserById(id)));
    return {
      id: group.id,
      name: group.name,
      icon: group.icon,
      createdBy: group.createdBy,
      members: members.map(publicUser).filter(Boolean),
      activeCallMemberIds: activeCallMemberIds(group.id),
    };
  }

  // Broadcast to EVERY group member (not just people currently on the call)
  // so the "who's on this call" facepile stays live even for someone just
  // looking at the group's chat header.
  async function broadcastGroupCallRoster(groupId) {
    const group = await db.getGroupById(groupId);
    if (!group) return;
    const participantIds = activeCallMemberIds(groupId);
    group.members.forEach((id) => {
      io.to(`user:${id}`).emit('call:group-roster', { groupId, participantIds });
    });
  }

  function onlineGroupMembers(group, excludeUserId) {
    return group.members.filter((id) => id !== excludeUserId && presence.has(id) && presence.get(id).size > 0);
  }

  io.on('connection', (socket) => {
    let currentUserId = null;

    async function joinSession(user) {
      currentUserId = user.id;
      socket.join(`user:${user.id}`);
      if (!presence.has(user.id)) presence.set(user.id, new Set());
      presence.get(user.id).add(socket.id);

      const [friendRows, incomingRows, outgoingRows] = await Promise.all([
        db.listFriends(user.id),
        db.listPendingIncoming(user.id),
        db.listPendingOutgoing(user.id),
      ]);

      await broadcastPresence(user);

      return {
        user: selfUser(user),
        friends: friendRows.map(publicUser),
        incoming: incomingRows.map(publicUser),
        outgoing: outgoingRows.map(publicUser),
      };
    }

    socket.on('auth:register', async ({ username, password, confirmPassword }, ack) => {
      if (password !== confirmPassword) return ack && ack({ error: 'password_mismatch' });
      const result = await db.createAccount({ username, password });
      if (result.error) return ack && ack({ error: result.error });
      ack && ack(await joinSession(result.user));
    });

    socket.on('auth:login', async ({ username, password }, ack) => {
      const result = await db.authenticate({ username, password });
      if (result.error) return ack && ack({ error: result.error });
      ack && ack(await joinSession(result.user));
    });

    // Silent relogin using the id saved locally after a previous successful
    // login/register — lets the app skip the login screen until the user
    // explicitly logs out, without storing the password on disk.
    socket.on('auth:session', async ({ id }, ack) => {
      const user = await db.getUserById(id);
      if (!user) return ack && ack({ error: 'not_found' });
      ack && ack(await joinSession(user));
    });

    socket.on('profile:update', async (patch, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const result = await db.updateUserProfile(currentUserId, patch);
      if (result.error) return ack && ack({ error: result.error });
      ack && ack({ user: selfUser(result.user) });
      broadcastProfile(result.user);
    });

    socket.on('status:update', async ({ status }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!VALID_STATUSES.includes(status)) return ack && ack({ error: 'invalid_status' });
      const user = await db.updateUserStatus(currentUserId, status);
      ack && ack({ user: selfUser(user) });
      broadcastPresence(user);
    });

    socket.on('friend:request', async ({ username, tag }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const result = await db.createFriendRequest(currentUserId, String(username || ''), String(tag || ''));
      if (result.error) return ack && ack({ error: result.error });
      const fromUser = await db.getUserById(currentUserId);
      // Both sides need friendshipId attached so their Accept/Decline/Cancel
      // buttons work immediately — db.getUserById() doesn't carry it (only
      // listPendingIncoming/Outgoing do), so it must be added by hand here.
      io.to(`user:${result.target.id}`).emit('friend:incoming', { ...publicUser(fromUser), friendshipId: result.friendship.id });
      ack && ack({ ok: true, target: { ...publicUser(result.target), friendshipId: result.friendship.id } });
    });

    socket.on('friend:respond', async ({ friendshipId, accept }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const result = await db.respondFriendRequest(friendshipId, currentUserId, !!accept);
      if (result.error) return ack && ack({ error: result.error });
      const { friendship } = result;
      const otherId = friendship
        ? (friendship.userA === currentUserId ? friendship.userB : friendship.userA)
        : null;
      ack && ack({ ok: true });
      if (otherId) {
        const [me, other] = await Promise.all([db.getUserById(currentUserId), db.getUserById(otherId)]);
        io.to(`user:${currentUserId}`).emit('friend:updated', {});
        io.to(`user:${otherId}`).emit('friend:updated', {});
        if (accept) {
          broadcastPresence(me);
          broadcastPresence(other);
        }
      }
    });

    socket.on('friend:remove', async ({ friendId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      await db.removeFriend(currentUserId, friendId);
      io.to(`user:${currentUserId}`).emit('friend:updated', {});
      io.to(`user:${friendId}`).emit('friend:updated', {});
      ack && ack({ ok: true });
    });

    socket.on('friends:list', async (_payload, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const [friends, incoming, outgoing] = await Promise.all([
        db.listFriends(currentUserId),
        db.listPendingIncoming(currentUserId),
        db.listPendingOutgoing(currentUserId),
      ]);
      ack && ack({ friends: friends.map(publicUser), incoming: incoming.map(publicUser), outgoing: outgoing.map(publicUser) });
    });

    socket.on('message:send', async ({ to, text }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!(await db.areFriends(currentUserId, to))) return ack && ack({ error: 'not_friends' });
      const trimmed = String(text || '').trim();
      if (!trimmed) return ack && ack({ error: 'empty' });
      const message = await db.addMessage(currentUserId, to, trimmed);
      ack && ack({ ok: true, message });
      io.to(`user:${to}`).emit('message:receive', message);
    });

    socket.on('messages:history', async ({ withUserId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const history = await db.getConversation(currentUserId, withUserId);
      ack && ack({ messages: history });
    });

    // --- Groups ---
    socket.on('group:create', async ({ name, memberIds }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const others = Array.isArray(memberIds) ? memberIds : [];
      for (const id of others) {
        if (!(await db.areFriends(currentUserId, id))) return ack && ack({ error: 'not_friends' });
      }
      const result = await db.createGroup(currentUserId, name, [currentUserId, ...others]);
      if (result.error) return ack && ack({ error: result.error });
      const payload = await publicGroup(result.group);
      result.group.members.forEach((id) => io.to(`user:${id}`).emit('group:created', payload));
      ack && ack({ ok: true, group: payload });
    });

    socket.on('group:update', async ({ groupId, name, icon }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!(await db.isGroupMember(groupId, currentUserId))) return ack && ack({ error: 'not_member' });
      const updated = await db.updateGroup(groupId, { name, icon });
      const payload = await publicGroup(updated);
      updated.members.forEach((id) => io.to(`user:${id}`).emit('group:updated', payload));
      ack && ack({ ok: true, group: payload });
    });

    socket.on('group:add-members', async ({ groupId, memberIds }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!(await db.isGroupMember(groupId, currentUserId))) return ack && ack({ error: 'not_member' });
      const others = Array.isArray(memberIds) ? memberIds : [];
      for (const id of others) {
        if (!(await db.areFriends(currentUserId, id))) return ack && ack({ error: 'not_friends' });
      }
      const result = await db.addGroupMembers(groupId, others);
      if (result.error) return ack && ack({ error: result.error });
      const payload = await publicGroup(result.group);
      result.group.members.forEach((id) => io.to(`user:${id}`).emit('group:updated', payload));
      ack && ack({ ok: true, group: payload });
    });

    socket.on('groups:list', async (_payload, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const groups = await db.listGroupsForUser(currentUserId);
      const payloads = await Promise.all(groups.map(publicGroup));
      ack && ack({ groups: payloads });
    });

    socket.on('group:message:send', async ({ groupId, text }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!(await db.isGroupMember(groupId, currentUserId))) return ack && ack({ error: 'not_member' });
      const trimmed = String(text || '').trim();
      if (!trimmed) return ack && ack({ error: 'empty' });
      const message = await db.addGroupMessage(groupId, currentUserId, trimmed);
      ack && ack({ ok: true, message });
      const group = await db.getGroupById(groupId);
      group.members.forEach((id) => {
        if (id !== currentUserId) io.to(`user:${id}`).emit('group:message:receive', message);
      });
    });

    socket.on('group:messages:history', async ({ groupId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!(await db.isGroupMember(groupId, currentUserId))) return ack && ack({ error: 'not_member' });
      const history = await db.getGroupConversation(groupId);
      ack && ack({ messages: history });
    });

    // --- Group call signaling (mesh: every participant connects to every other) ---
    socket.on('call:group-start', async ({ groupId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const group = await db.getGroupById(groupId);
      if (!group || !group.members.includes(currentUserId)) return ack && ack({ error: 'not_member' });
      if (!groupCallParticipants.has(groupId)) groupCallParticipants.set(groupId, new Set());
      groupCallParticipants.get(groupId).add(currentUserId);
      const caller = await db.getUserById(currentUserId);
      const groupPayload = await publicGroup(group);
      onlineGroupMembers(group, currentUserId).forEach((id) => {
        io.to(`user:${id}`).emit('call:group-incoming', { group: groupPayload, from: publicUser(caller) });
      });
      broadcastGroupCallRoster(groupId);
      ack && ack({ ok: true });
    });

    socket.on('call:group-join', async ({ groupId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const group = await db.getGroupById(groupId);
      if (!group || !group.members.includes(currentUserId)) return ack && ack({ error: 'not_member' });
      if (!groupCallParticipants.has(groupId)) groupCallParticipants.set(groupId, new Set());
      const participants = groupCallParticipants.get(groupId);
      const existing = [...participants].filter((id) => id !== currentUserId);
      participants.add(currentUserId);
      const joiner = await db.getUserById(currentUserId);
      existing.forEach((id) => {
        io.to(`user:${id}`).emit('call:group-participant-joined', { groupId, user: publicUser(joiner) });
      });
      broadcastGroupCallRoster(groupId);
      const existingUsers = await Promise.all(existing.map((id) => db.getUserById(id)));
      ack && ack({ ok: true, participants: existingUsers.map(publicUser) });
    });

    socket.on('call:group-leave', async ({ groupId }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const participants = groupCallParticipants.get(groupId);
      if (participants) {
        participants.delete(currentUserId);
        participants.forEach((id) => {
          io.to(`user:${id}`).emit('call:group-participant-left', { groupId, userId: currentUserId });
        });
        if (participants.size === 0) groupCallParticipants.delete(groupId);
      }
      broadcastGroupCallRoster(groupId);
      ack && ack({ ok: true });
    });

    const groupRelay = (event) => async (payload, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const { groupId, to } = payload;
      if (!(await db.isGroupMember(groupId, currentUserId))) return ack && ack({ error: 'not_member' });
      io.to(`user:${to}`).emit(event, { ...payload, from: currentUserId });
      ack && ack({ ok: true });
    };
    socket.on('call:group-offer', groupRelay('call:group-offer'));
    socket.on('call:group-answer', groupRelay('call:group-answer'));
    socket.on('call:group-ice-candidate', groupRelay('call:group-ice-candidate'));

    socket.on('screenshare:group-state', ({ groupId, sharing }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const participants = groupCallParticipants.get(groupId);
      if (!participants || !participants.has(currentUserId)) return ack && ack({ error: 'not_in_call' });
      participants.forEach((id) => {
        if (id !== currentUserId) io.to(`user:${id}`).emit('screenshare:group-state', { groupId, userId: currentUserId, sharing });
      });
      ack && ack({ ok: true });
    });

    // --- Call signaling (relay only) ---
    const relay = (event) => async (payload, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      const { to } = payload;
      if (!(await db.areFriends(currentUserId, to))) return ack && ack({ error: 'not_friends' });
      io.to(`user:${to}`).emit(event, { ...payload, from: currentUserId });
      ack && ack({ ok: true });
    };

    // call:invite is special-cased: the callee has no prior knowledge of the
    // caller, so call:incoming must carry the caller's full public profile
    // (id/username/tag/avatar), not just a bare id like every other relayed
    // call:* event (whose payload the callee/caller already know how to map
    // back to the peer they started the call with).
    socket.on('call:invite', async ({ to }, ack) => {
      if (!currentUserId) return ack && ack({ error: 'unauthorized' });
      if (!(await db.areFriends(currentUserId, to))) return ack && ack({ error: 'not_friends' });
      const targetOnline = presence.has(to) && presence.get(to).size > 0;
      if (!targetOnline) return ack && ack({ error: 'offline' });
      const caller = await db.getUserById(currentUserId);
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

    socket.on('disconnect', async () => {
      if (!currentUserId) return;
      const set = presence.get(currentUserId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          presence.delete(currentUserId);
          const user = await db.getUserById(currentUserId);
          if (user) broadcastPresence(user);
          for (const [groupId, participants] of groupCallParticipants) {
            if (!participants.has(currentUserId)) continue;
            participants.delete(currentUserId);
            participants.forEach((id) => {
              io.to(`user:${id}`).emit('call:group-participant-left', { groupId, userId: currentUserId });
            });
            if (participants.size === 0) groupCallParticipants.delete(groupId);
            broadcastGroupCallRoster(groupId);
          }
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
