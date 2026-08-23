import { emit, on } from './api.js';
import { callManager } from './call.js';
import {
  escapeHtml, initials, avatarStyle, statusLabel, statusDotClass,
  formatTime, formatDayTime, toast, el,
} from './ui.js';

const state = {
  currentUser: null,
  friends: [],
  incoming: [],
  outgoing: [],
  activeTab: 'friends',
  selectedPeerId: null,
  conversations: {}, // peerId -> { messages: [] | null, unread: number }
  callViewExpanded: true,
  pendingAutoShare: null,
};

const dom = {
  onboarding: document.getElementById('onboarding-screen'),
  onboardingName: document.getElementById('onboarding-name'),
  onboardingSubmit: document.getElementById('onboarding-submit'),
  onboardingPreviewName: document.getElementById('onboarding-preview-name'),
  onboardingError: document.getElementById('onboarding-error'),

  mainApp: document.getElementById('main-app'),
  navIndicator: document.getElementById('nav-indicator'),
  chatUnreadDot: document.getElementById('chat-unread-dot'),

  addFriendInput: document.getElementById('add-friend-input'),
  addFriendBtn: document.getElementById('add-friend-btn'),
  addFriendFeedback: document.getElementById('add-friend-feedback'),
  pendingSection: document.getElementById('pending-section'),
  pendingList: document.getElementById('pending-list'),
  outgoingSection: document.getElementById('outgoing-section'),
  outgoingList: document.getElementById('outgoing-list'),
  onlineLabel: document.getElementById('online-label'),
  onlineList: document.getElementById('online-list'),
  offlineLabel: document.getElementById('offline-label'),
  offlineList: document.getElementById('offline-list'),
  friendsEmptyState: document.getElementById('friends-empty-state'),

  profileAvatar: document.getElementById('profile-avatar'),
  profileAvatarEdit: document.getElementById('profile-avatar-edit'),
  profileNameInput: document.getElementById('profile-name-input'),
  profileTag: document.getElementById('profile-tag'),
  statusOptions: document.getElementById('status-options'),
  profileBioInput: document.getElementById('profile-bio-input'),
  profileSaveBtn: document.getElementById('profile-save-btn'),
  profileSaveHint: document.getElementById('profile-save-hint'),

  dmListItems: document.getElementById('dm-list-items'),
  dmListEmpty: document.getElementById('dm-list-empty'),
  chatMain: document.getElementById('chat-main'),
  chatEmpty: document.getElementById('chat-empty'),
  chatTextView: document.getElementById('chat-text-view'),
  chatHeader: document.getElementById('chat-header'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  chatSendBtn: document.getElementById('chat-send-btn'),

  callBar: document.getElementById('call-bar'),
  callBarTitle: document.getElementById('call-bar-title'),
  callBarTimer: document.getElementById('call-bar-timer'),
  callBarMic: document.getElementById('call-bar-mic'),
  callBarShare: document.getElementById('call-bar-share'),
  callBarExpand: document.getElementById('call-bar-expand'),
  callBarEnd: document.getElementById('call-bar-end'),

  callView: document.getElementById('call-view'),
  callViewHeader: document.getElementById('call-view-header'),
  callViewBody: document.getElementById('call-view-body'),
  callViewControls: document.getElementById('call-view-controls'),

  incomingModal: document.getElementById('incoming-call-modal'),
  incomingAvatar: document.getElementById('incoming-call-avatar'),
  incomingName: document.getElementById('incoming-call-name'),
  incomingAccept: document.getElementById('incoming-call-accept'),
  incomingDecline: document.getElementById('incoming-call-decline'),

  pickerModal: document.getElementById('screenshare-picker-modal'),
  pickerSources: document.getElementById('picker-sources'),
  pickerCancel: document.getElementById('picker-cancel'),
};

// ---------------- Icons ----------------
const ICONS = {
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3.2M9 20.7h6"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3.2M9 20.7h6"/><path d="M4 4l16 16"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4.5" height="6.5" rx="1.6"/><rect x="16.5" y="13" width="4.5" height="6.5" rx="1.6"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20.5h8M12 16.5v4"/><path d="M9 11l2.3-2.3L13 10.4 16 7.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 9 6c.4 1.4.1 2.9-1 4l-.8.8c1 2.4 3.1 4.5 5.5 5.5l.8-.8c1.1-1.1 2.6-1.4 4-1l2.5 3c-1.2 2-3.3 3-5.5 2.6C9.4 19 5 14.6 4.4 9.5 4 7.3 5 5.2 6 3.5Z"/></svg>',
  phoneEnd: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 14.5c1.5-3.5 5-5.5 7.5-5.5s6 2 7.5 5.5c.3.7-.1 1.5-.8 1.7l-2.7.8c-.6.2-1.3-.1-1.6-.7l-.6-1.2c-1.5.4-3 .4-4.6 0l-.6 1.2c-.3.6-1 .9-1.6.7l-2.7-.8c-.7-.2-1.1-1-.8-1.7Z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-7-6.5 16-2.7-6.8L4 12Z"/></svg>',
};

// ---------------- Boot ----------------
window.orbit.screenShare.onPickRequest((sources) => showScreenSharePicker(sources));

boot();

async function boot() {
  wireOnboarding();
  wireStaticHandlers();
  callManager.onUpdate(onCallUpdate);
  setInterval(tickTimers, 1000);

  const saved = await window.orbit.session.load();
  if (saved && saved.id) {
    try {
      const res = await emit('auth', { id: saved.id });
      onLoggedIn(res);
      return;
    } catch {
      await window.orbit.session.clear();
    }
  }
  dom.onboarding.hidden = false;
  dom.onboardingName.focus();
}

// ---------------- Onboarding ----------------
function wireOnboarding() {
  dom.onboardingName.addEventListener('input', () => {
    const value = dom.onboardingName.value.trim();
    dom.onboardingPreviewName.textContent = value || 'seunome';
    dom.onboardingSubmit.disabled = value.length === 0;
  });
  dom.onboardingName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !dom.onboardingSubmit.disabled) submitOnboarding();
  });
  dom.onboardingSubmit.addEventListener('click', submitOnboarding);
}

async function submitOnboarding() {
  const username = dom.onboardingName.value.trim();
  if (!username) return;
  dom.onboardingSubmit.disabled = true;
  dom.onboardingError.hidden = true;
  try {
    const res = await emit('register', { username });
    await window.orbit.session.save({ id: res.user.id });
    onLoggedIn(res);
  } catch (err) {
    dom.onboardingError.textContent = 'Não foi possível criar seu perfil. Tente novamente.';
    dom.onboardingError.hidden = false;
    dom.onboardingSubmit.disabled = false;
  }
}

// ---------------- Login ----------------
function onLoggedIn(res) {
  state.currentUser = res.user;
  state.friends = res.friends;
  state.incoming = res.incoming;
  state.outgoing = res.outgoing;

  dom.onboarding.hidden = true;
  dom.mainApp.hidden = false;

  bindRealtimeEvents();
  renderProfile();
  renderFriends();
  renderDmList();
  switchTab('friends');
}

function bindRealtimeEvents() {
  on('presence:update', ({ userId, status }) => {
    const friend = state.friends.find((f) => f.id === userId);
    if (friend) friend.status = status;
    renderFriends();
    renderDmList();
    if (state.selectedPeerId === userId) renderChatHeaderIfSelected();
  });

  on('friend:profile', (user) => {
    const idx = state.friends.findIndex((f) => f.id === user.id);
    if (idx >= 0) state.friends[idx] = { ...state.friends[idx], ...user };
    renderFriends();
    renderDmList();
    if (state.selectedPeerId === user.id) renderChatHeaderIfSelected();
  });

  on('friend:incoming', (fromUser) => {
    if (!state.incoming.some((f) => f.id === fromUser.id)) state.incoming.push(fromUser);
    toast(`${fromUser.username}#${fromUser.tag} quer te adicionar como amigo`);
    renderFriends();
  });

  on('friend:updated', async () => {
    try {
      const res = await emit('friends:list');
      state.friends = res.friends;
      state.incoming = res.incoming;
      state.outgoing = res.outgoing;
      renderFriends();
      renderDmList();
    } catch { /* ignore */ }
  });

  on('message:receive', (message) => {
    const peerId = message.from;
    const conv = state.conversations[peerId] || (state.conversations[peerId] = { messages: null, unread: 0 });
    if (conv.messages === null) conv.messages = [];
    conv.messages.push(message);
    if (state.activeTab === 'chat' && state.selectedPeerId === peerId) {
      renderChatMessages();
    } else {
      conv.unread += 1;
    }
    renderDmList();
    updateNavUnreadDot();
  });
}

// ---------------- Tabs ----------------
const TAB_ORDER = ['friends', 'profile', 'chat'];
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
  const idx = TAB_ORDER.indexOf(tab);
  dom.navIndicator.style.top = `${26 + idx * 60}px`;
  if (tab === 'chat') updateNavUnreadDot();
}

function updateNavUnreadDot() {
  const hasUnread = Object.values(state.conversations).some((c) => c.unread > 0);
  dom.chatUnreadDot.hidden = !(hasUnread && state.activeTab !== 'chat');
}

function wireStaticHandlers() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Friends
  dom.addFriendBtn.addEventListener('click', submitAddFriend);
  dom.addFriendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAddFriend();
  });

  // Profile
  dom.profileAvatarEdit.addEventListener('click', async () => {
    const dataUrl = await window.orbit.avatar.pick();
    if (!dataUrl) return;
    try {
      const res = await emit('profile:update', { avatar: { type: 'image', dataUrl } });
      state.currentUser = res.user;
      renderProfile();
      toast('Foto de perfil atualizada', 'ok');
    } catch {
      toast('Não foi possível atualizar a foto', 'err');
    }
  });

  dom.statusOptions.querySelectorAll('.status-option').forEach((opt) => {
    opt.addEventListener('click', async () => {
      const status = opt.dataset.status;
      try {
        const res = await emit('status:update', { status });
        state.currentUser = res.user;
        renderProfile();
      } catch {
        toast('Não foi possível atualizar o status', 'err');
      }
    });
  });

  dom.profileSaveBtn.addEventListener('click', async () => {
    const username = dom.profileNameInput.value.trim();
    const statusMessage = dom.profileBioInput.value.trim();
    if (!username) { toast('O nome não pode ficar vazio', 'err'); return; }
    try {
      const res = await emit('profile:update', { username, statusMessage });
      state.currentUser = res.user;
      renderProfile();
      dom.profileSaveHint.textContent = 'Alterações salvas';
      dom.profileSaveHint.classList.add('show');
      setTimeout(() => dom.profileSaveHint.classList.remove('show'), 2200);
    } catch {
      toast('Não foi possível salvar o perfil', 'err');
    }
  });

  // Chat input
  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  dom.chatInput.addEventListener('input', () => {
    dom.chatInput.style.height = 'auto';
    dom.chatInput.style.height = `${Math.min(dom.chatInput.scrollHeight, 120)}px`;
  });
  dom.chatSendBtn.addEventListener('click', sendMessage);

  // Incoming call modal
  dom.incomingAccept.addEventListener('click', () => callManager.acceptIncoming());
  dom.incomingDecline.addEventListener('click', () => callManager.declineIncoming());

  // Call bar
  dom.callBarMic.addEventListener('click', () => callManager.toggleMic());
  dom.callBarShare.addEventListener('click', () => callManager.toggleScreenShare());
  dom.callBarExpand.addEventListener('click', () => { state.callViewExpanded = true; renderChatMain(); });
  dom.callBarEnd.addEventListener('click', () => callManager.endCall());

  // Screen share picker
  dom.pickerCancel.addEventListener('click', () => {
    window.orbit.screenShare.choose(null);
    dom.pickerModal.hidden = true;
  });
}

// ---------------- Friends tab ----------------
async function submitAddFriend() {
  const raw = dom.addFriendInput.value.trim();
  const match = raw.match(/^(.+)#(\d{1,4})$/);
  if (!match) {
    showAddFriendFeedback('Use o formato usuario#0000', false);
    return;
  }
  const username = match[1].trim();
  const tag = match[2].padStart(4, '0');
  try {
    const res = await emit('friend:request', { username, tag });
    if (!state.outgoing.some((f) => f.id === res.target.id)) state.outgoing.push(res.target);
    renderFriends();
    dom.addFriendInput.value = '';
    showAddFriendFeedback(`Pedido enviado para ${res.target.username}#${res.target.tag}`, true);
  } catch (err) {
    const messages = {
      not_found: 'Não encontramos esse usuário. Confira o nome e a tag.',
      self: 'Você não pode adicionar a si mesmo.',
      already_friends: 'Vocês já são amigos.',
      already_pending: 'Já existe um pedido de amizade entre vocês.',
    };
    showAddFriendFeedback(messages[err.message] || 'Não foi possível enviar o pedido.', false);
  }
}

function showAddFriendFeedback(text, ok) {
  dom.addFriendFeedback.textContent = text;
  dom.addFriendFeedback.className = `add-friend-feedback ${ok ? 'ok' : 'err'}`;
  dom.addFriendFeedback.hidden = false;
  setTimeout(() => { dom.addFriendFeedback.hidden = true; }, 4000);
}

function renderFriends() {
  const online = state.friends.filter((f) => f.status !== 'offline');
  const offline = state.friends.filter((f) => f.status === 'offline');

  dom.pendingSection.hidden = state.incoming.length === 0;
  dom.pendingList.innerHTML = state.incoming.map((u) => friendRequestRowHtml(u, true)).join('');

  dom.outgoingSection.hidden = state.outgoing.length === 0;
  dom.outgoingList.innerHTML = state.outgoing.map((u) => friendRequestRowHtml(u, false)).join('');

  dom.onlineLabel.textContent = `Online — ${online.length}`;
  dom.onlineList.innerHTML = online.map((u) => friendRowHtml(u)).join('');

  dom.offlineLabel.textContent = `Offline — ${offline.length}`;
  dom.offlineList.innerHTML = offline.map((u) => friendRowHtml(u)).join('');

  dom.friendsEmptyState.hidden = state.friends.length > 0;

  dom.pendingList.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', () => respondFriendRequest(btn.dataset.accept, true));
  });
  dom.pendingList.querySelectorAll('[data-decline]').forEach((btn) => {
    btn.addEventListener('click', () => respondFriendRequest(btn.dataset.decline, false));
  });
  dom.outgoingList.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => cancelOutgoingRequest(btn.dataset.cancel));
  });
  document.querySelectorAll('[data-chat-with]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab('chat');
      selectConversation(btn.dataset.chatWith);
    });
  });
  document.querySelectorAll('[data-call-with]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const friend = state.friends.find((f) => f.id === btn.dataset.callWith);
      if (!friend) return;
      switchTab('chat');
      selectConversation(friend.id);
      requestCall(friend);
    });
  });
}

function friendRowHtml(u) {
  const isOffline = u.status === 'offline';
  const sub = isOffline ? 'Offline' : (u.statusMessage || statusLabel(u.status));
  return `
  <div class="friend-row ${isOffline ? 'offline' : ''}">
    <div class="friend-row-avatar">
      <div class="avatar avatar-md" style="${avatarStyle(u)}">${avatarInner(u)}</div>
      <span class="status-dot ${statusDotClass(u.status)}"></span>
    </div>
    <div class="friend-row-info">
      <div class="friend-row-name">${escapeHtml(u.username)}<span style="color:var(--text-muted);font-weight:600;">#${u.tag}</span></div>
      <div class="friend-row-sub">${escapeHtml(sub)}</div>
    </div>
    <div class="friend-row-actions">
      <button class="icon-btn" data-chat-with="${u.id}" title="Mensagem">${iconChat()}</button>
      <button class="icon-btn" data-call-with="${u.id}" title="Chamar">${ICONS.phone}</button>
    </div>
  </div>`;
}

function friendRequestRowHtml(u, isIncoming) {
  return `
  <div class="friend-row">
    <div class="friend-row-avatar">
      <div class="avatar avatar-md" style="${avatarStyle(u)}">${avatarInner(u)}</div>
    </div>
    <div class="friend-row-info">
      <div class="friend-row-name">${escapeHtml(u.username)}<span style="color:var(--text-muted);font-weight:600;">#${u.tag}</span></div>
      <div class="friend-row-sub">${isIncoming ? 'Quer ser seu amigo' : 'Pedido enviado — aguardando resposta'}</div>
    </div>
    <div class="friend-row-actions">
      ${isIncoming
        ? `<button class="btn btn-primary btn-small" data-accept="${u.friendshipId}">Aceitar</button>
           <button class="btn btn-ghost btn-small" data-decline="${u.friendshipId}">Recusar</button>`
        : `<button class="btn btn-ghost btn-small" data-cancel="${u.friendshipId}">Cancelar</button>`}
    </div>
  </div>`;
}

async function respondFriendRequest(friendshipId, accept) {
  state.incoming = state.incoming.filter((f) => f.friendshipId !== friendshipId);
  renderFriends();
  try {
    await emit('friend:respond', { friendshipId, accept });
  } catch {
    toast('Não foi possível responder ao pedido', 'err');
  }
}

async function cancelOutgoingRequest(friendshipId) {
  const target = state.outgoing.find((f) => f.friendshipId === friendshipId);
  state.outgoing = state.outgoing.filter((f) => f.friendshipId !== friendshipId);
  renderFriends();
  if (target) {
    try { await emit('friend:remove', { friendId: target.id }); } catch { /* ignore */ }
  }
}

function avatarInner(u) {
  if (u.avatar && u.avatar.type === 'image' && u.avatar.dataUrl) return '';
  return escapeHtml(initials(u.username));
}

function iconChat() {
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5c0-1.4 1.1-2.5 2.5-2.5h11c1.4 0 2.5 1.1 2.5 2.5v8c0 1.4-1.1 2.5-2.5 2.5H10l-4.5 4v-4H6.5C5.1 17 4 15.9 4 14.5v-8Z"/></svg>';
}

// ---------------- Profile tab ----------------
function renderProfile() {
  const u = state.currentUser;
  if (!u) return;
  dom.profileAvatar.style.cssText = avatarStyle(u);
  dom.profileAvatar.textContent = avatarInner(u);
  dom.profileNameInput.value = u.username;
  dom.profileTag.textContent = `#${u.tag}`;
  dom.statusOptions.querySelectorAll('.status-option').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.status === u.status);
  });
  dom.profileBioInput.value = u.statusMessage || '';
}

// ---------------- Conversas tab ----------------
function renderDmList() {
  const rows = state.friends.map((f) => {
    const conv = state.conversations[f.id];
    const lastMsg = conv && conv.messages && conv.messages.length ? conv.messages[conv.messages.length - 1] : null;
    return { friend: f, lastMsg, unread: conv ? conv.unread : 0 };
  });
  rows.sort((a, b) => (b.lastMsg?.createdAt || 0) - (a.lastMsg?.createdAt || 0));

  dom.dmListEmpty.hidden = state.friends.length > 0;
  dom.dmListItems.innerHTML = rows.map(({ friend, lastMsg, unread }) => {
    const preview = lastMsg
      ? `${lastMsg.from === state.currentUser.id ? 'Você: ' : ''}${escapeHtml(lastMsg.text)}`
      : '<span style="color:var(--text-muted);">Diga oi!</span>';
    const time = lastMsg ? formatDayTime(lastMsg.createdAt) : '';
    const inCall = callManager.state !== 'idle' && callManager.peer && callManager.peer.id === friend.id;
    return `
    <div class="dm-row ${state.selectedPeerId === friend.id ? 'selected' : ''}" data-peer="${friend.id}">
      <div class="dm-row-avatar">
        <div class="avatar avatar-md" style="${avatarStyle(friend)}">${avatarInner(friend)}</div>
        <span class="status-dot ${statusDotClass(friend.status)}"></span>
      </div>
      <div class="dm-row-info">
        <div class="dm-row-name">${escapeHtml(friend.username)}</div>
        <div class="dm-row-preview">${inCall ? '<span style="color:var(--accent);font-weight:600;">Em chamada</span>' : preview}</div>
      </div>
      <div class="dm-row-meta">
        <div class="dm-row-time">${time}</div>
        ${unread > 0 ? `<div class="dm-row-unread">${unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  dom.dmListItems.querySelectorAll('[data-peer]').forEach((rowEl) => {
    rowEl.addEventListener('click', () => selectConversation(rowEl.dataset.peer));
  });
}

async function selectConversation(peerId) {
  state.selectedPeerId = peerId;
  const conv = state.conversations[peerId] || (state.conversations[peerId] = { messages: null, unread: 0 });
  if (conv.messages === null) {
    try {
      const res = await emit('messages:history', { withUserId: peerId });
      conv.messages = res.messages;
    } catch {
      conv.messages = [];
    }
  }
  conv.unread = 0;
  renderDmList();
  updateNavUnreadDot();
  renderChatMain();
}

function renderChatHeaderIfSelected() {
  if (state.activeTab === 'chat' && state.selectedPeerId && !isCallViewShowing()) renderChatMain();
}

function isCallViewShowing() {
  return callManager.state !== 'idle' && state.callViewExpanded;
}

function currentFriend(peerId) {
  return state.friends.find((f) => f.id === peerId) || null;
}

function renderChatMain() {
  const callActive = callManager.state !== 'idle';
  dom.callBar.hidden = !callActive;
  if (callActive) renderCallBar();

  if (callActive && state.callViewExpanded) {
    dom.chatEmpty.hidden = true;
    dom.chatTextView.hidden = true;
    dom.callView.hidden = false;
    renderCallView();
    return;
  }

  dom.callView.hidden = true;

  if (!state.selectedPeerId) {
    dom.chatEmpty.hidden = false;
    dom.chatTextView.hidden = true;
    return;
  }

  const friend = currentFriend(state.selectedPeerId);
  if (!friend) {
    dom.chatEmpty.hidden = false;
    dom.chatTextView.hidden = true;
    return;
  }

  dom.chatEmpty.hidden = true;
  dom.chatTextView.hidden = false;
  renderChatHeader(friend);
  renderChatMessages();
}

function renderChatHeader(friend) {
  const inCallWithFriend = callManager.state !== 'idle' && callManager.peer && callManager.peer.id === friend.id;
  dom.chatHeader.innerHTML = `
    <div class="chat-header-user">
      <div class="chat-header-avatar">
        <div class="avatar avatar-sm" style="${avatarStyle(friend)}">${avatarInner(friend)}</div>
        <span class="status-dot ${statusDotClass(friend.status)}"></span>
      </div>
      <div>
        <div class="chat-header-name">${escapeHtml(friend.username)}</div>
        <div class="chat-header-status">${friend.status === 'offline' ? 'Offline' : (friend.statusMessage || statusLabel(friend.status))}</div>
      </div>
    </div>
    <div class="chat-header-actions">
      <button class="icon-btn" id="chat-call-btn" title="Chamada de voz">${ICONS.phone}</button>
      <button class="icon-btn" id="chat-share-btn" title="Compartilhar tela">${ICONS.monitor}</button>
    </div>`;

  document.getElementById('chat-call-btn').addEventListener('click', () => requestCall(friend));
  document.getElementById('chat-share-btn').addEventListener('click', () => requestScreenShare(friend));

  if (inCallWithFriend) {
    document.getElementById('chat-call-btn').classList.add('active');
  }
}

function requestCall(friend) {
  if (callManager.state !== 'idle') {
    if (callManager.peer && callManager.peer.id === friend.id) {
      state.callViewExpanded = true;
      // That friend already called us (we're ringing) or the call is already
      // under way — clicking "call" here just joins it instead of trying to
      // place a second, redundant invite.
      if (callManager.state === 'ringing') callManager.acceptIncoming();
      else renderChatMain();
    } else {
      toast('Você já está em uma chamada');
    }
    return;
  }
  state.callViewExpanded = true;
  callManager.startCall(friend);
}

function requestScreenShare(friend) {
  if (callManager.state === 'connected' && callManager.peer && callManager.peer.id === friend.id) {
    state.callViewExpanded = true;
    callManager.toggleScreenShare();
    return;
  }
  if (callManager.state !== 'idle') {
    toast('Você já está em uma chamada');
    return;
  }
  state.pendingAutoShare = friend.id;
  state.callViewExpanded = true;
  callManager.startCall(friend);
}

// ---------------- Messages ----------------
function renderChatMessages() {
  const conv = state.conversations[state.selectedPeerId];
  const friend = currentFriend(state.selectedPeerId);
  const messages = (conv && conv.messages) || [];
  dom.chatMessages.innerHTML = messages.map((m) => {
    const mine = m.from === state.currentUser.id;
    if (mine) {
      return `<div class="msg-row msg-row-out"><div class="msg-bubble-out">${escapeHtml(m.text)}</div></div>`;
    }
    return `
      <div class="msg-row">
        <div class="avatar msg-avatar" style="${avatarStyle(friend)}">${friend ? avatarInner(friend) : ''}</div>
        <div class="msg-body">
          <div class="msg-meta"><span class="msg-author">${escapeHtml(friend ? friend.username : '')}</span><span class="msg-time">${formatTime(m.createdAt)}</span></div>
          <div class="msg-text">${escapeHtml(m.text)}</div>
        </div>
      </div>`;
  }).join('');
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

async function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || !state.selectedPeerId) return;
  dom.chatInput.value = '';
  dom.chatInput.style.height = 'auto';
  try {
    const res = await emit('message:send', { to: state.selectedPeerId, text });
    const conv = state.conversations[state.selectedPeerId] || (state.conversations[state.selectedPeerId] = { messages: [], unread: 0 });
    if (conv.messages === null) conv.messages = [];
    conv.messages.push(res.message);
    renderChatMessages();
    renderDmList();
  } catch {
    toast('Não foi possível enviar a mensagem', 'err');
  }
}

// ---------------- Call UI ----------------
function onCallUpdate(cm) {
  if (cm.state === 'connected' && state.pendingAutoShare && cm.peer && cm.peer.id === state.pendingAutoShare) {
    state.pendingAutoShare = null;
    cm.toggleScreenShare();
  }
  if (cm.state === 'idle') state.pendingAutoShare = null;

  renderIncomingModal();
  renderChatMain();
  renderDmList();
}

function renderIncomingModal() {
  const ringing = callManager.state === 'ringing';
  dom.incomingModal.hidden = !ringing;
  if (!ringing || !callManager.peer) return;
  const peer = callManager.peer;
  dom.incomingAvatar.style.cssText = avatarStyle(peer);
  dom.incomingAvatar.textContent = avatarInner(peer);
  dom.incomingName.textContent = `${peer.username}#${peer.tag}`;
}

function renderCallBar() {
  const cm = callManager;
  const peer = cm.peer;
  const label = cm.state === 'calling' ? 'Chamando...' : (cm.state === 'connected' ? (peer ? peer.username : '') : '');
  dom.callBarTitle.textContent = peer ? `${label || peer.username}` : 'Chamada';
  dom.callBarTimer.textContent = cm.state === 'connected' ? formatDuration(cm.elapsedSeconds()) : '';
  dom.callBarMic.innerHTML = cm.micMuted ? ICONS.micOff : ICONS.mic;
  dom.callBarMic.classList.toggle('active', !cm.micMuted && cm.state === 'connected');
  dom.callBarShare.innerHTML = ICONS.monitor;
  dom.callBarShare.classList.toggle('active', cm.sharingLocal);
  dom.callBarShare.style.display = cm.state === 'connected' ? '' : 'none';
  dom.callBarMic.style.display = cm.state === 'connected' ? '' : 'none';
  dom.callBarExpand.innerHTML = state.callViewExpanded ? ICONS.collapse : ICONS.expand;
  dom.callBarExpand.onclick = () => { state.callViewExpanded = !state.callViewExpanded; renderChatMain(); };
  dom.callBarEnd.innerHTML = ICONS.phoneEnd;
}

function renderCallView() {
  const cm = callManager;
  const peer = cm.peer;
  if (!peer) return;

  const statusText = cm.state === 'calling' ? 'Chamando...' : (cm.state === 'connected' ? formatDuration(cm.elapsedSeconds()) : '');
  const isSharing = cm.sharingLocal || cm.remoteSharing;

  dom.callViewHeader.innerHTML = `
    <div>
      <div class="call-view-title">${isSharing ? 'Compartilhamento de tela' : 'Chamada de voz'} — ${escapeHtml(peer.username)}</div>
      <div class="call-view-sub">${cm.state === 'calling' ? 'Chamando...' : '2 participantes'}</div>
    </div>
    <div class="call-view-timer">${cm.state === 'connected' ? formatDuration(cm.elapsedSeconds()) : ''}</div>`;

  if (isSharing) {
    dom.callViewBody.innerHTML = `
      <div class="screenshare-panel">
        <div class="screenshare-stage">
          <div class="screenshare-label">${cm.remoteSharing ? `${escapeHtml(peer.username)} está compartilhando a tela` : 'Você está compartilhando sua tela'}</div>
          <video id="screenshare-video" autoplay playsinline></video>
        </div>
        <div class="screenshare-strip">
          <div class="screenshare-thumb">
            <div class="avatar avatar-sm" style="${avatarStyle(state.currentUser)}">${avatarInner(state.currentUser)}</div>
            <div class="screenshare-thumb-name">Você</div>
          </div>
          <div class="screenshare-thumb">
            <div class="avatar avatar-sm" style="${avatarStyle(peer)}">${avatarInner(peer)}</div>
            <div class="screenshare-thumb-name">${escapeHtml(peer.username)}</div>
          </div>
        </div>
      </div>`;
    const videoEl = document.getElementById('screenshare-video');
    const stream = cm.remoteSharing ? cm.remoteScreenStream : cm.localScreenStream;
    if (videoEl && stream) videoEl.srcObject = stream;
  } else {
    dom.callViewBody.innerHTML = `
      <div class="participant-tile">
        <div class="avatar avatar-lg" style="${avatarStyle(state.currentUser)}">${avatarInner(state.currentUser)}</div>
        <div class="participant-tile-name">Você</div>
        <div class="participant-mic-badge ${cm.micMuted ? 'muted' : ''}">${cm.micMuted ? ICONS.micOff : ICONS.mic}</div>
      </div>
      <div class="participant-tile ${cm.state === 'connected' ? 'speaking-hint' : ''}">
        <div class="avatar avatar-lg" style="${avatarStyle(peer)}">${avatarInner(peer)}</div>
        <div class="participant-tile-name">${escapeHtml(peer.username)}</div>
        ${cm.state === 'calling' ? '<div class="participant-tile-name" style="font-weight:500;color:var(--text-tertiary);font-size:12px;">Chamando...</div>' : ''}
      </div>`;
  }

  const showControls = cm.state === 'calling' || cm.state === 'connected';
  dom.callViewControls.innerHTML = showControls ? `
    <div class="call-controls-pill">
      ${cm.state === 'connected' ? `
        <button class="call-control-btn ${!cm.micMuted ? '' : 'active'}" id="cv-mic" title="Mudo">${cm.micMuted ? ICONS.micOff : ICONS.mic}</button>
        <button class="call-control-btn ${cm.deafened ? 'active' : ''}" id="cv-deafen" title="Ensurdecer">${ICONS.headphones}</button>
        <button class="call-control-btn ${cm.sharingLocal ? 'active' : ''}" id="cv-share" title="Compartilhar tela">${ICONS.monitor}</button>
        <div class="call-control-divider"></div>
      ` : ''}
      <button class="call-control-btn call-control-end" id="cv-end" title="${cm.state === 'calling' ? 'Cancelar' : 'Encerrar'}">${ICONS.phoneEnd}</button>
    </div>` : '';

  if (showControls) {
    if (cm.state === 'connected') {
      document.getElementById('cv-mic').addEventListener('click', () => cm.toggleMic());
      document.getElementById('cv-deafen').addEventListener('click', () => cm.toggleDeafen());
      document.getElementById('cv-share').addEventListener('click', () => cm.toggleScreenShare());
    }
    document.getElementById('cv-end').addEventListener('click', () => {
      if (cm.state === 'calling') cm.cancelOutgoing();
      else cm.endCall();
    });
  }
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function tickTimers() {
  if (callManager.state !== 'connected') return;
  if (!dom.callBar.hidden) dom.callBarTimer.textContent = formatDuration(callManager.elapsedSeconds());
  if (!dom.callView.hidden) {
    const timerEl = dom.callViewHeader.querySelector('.call-view-timer');
    if (timerEl) timerEl.textContent = formatDuration(callManager.elapsedSeconds());
  }
}

// ---------------- Screen share picker ----------------
function showScreenSharePicker(sources) {
  dom.pickerSources.innerHTML = sources.map((s) => `
    <div class="picker-source" data-source-id="${s.id}">
      <img src="${s.thumbnail}" alt="">
      <div class="picker-source-name">${escapeHtml(s.name)}</div>
    </div>`).join('');
  dom.pickerSources.querySelectorAll('[data-source-id]').forEach((node) => {
    node.addEventListener('click', () => {
      window.orbit.screenShare.choose(node.dataset.sourceId);
      dom.pickerModal.hidden = true;
    });
  });
  dom.pickerModal.hidden = false;
}
