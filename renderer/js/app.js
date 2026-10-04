import { emit, on, socket } from './api.js';
import { callManager } from './call.js';
import { groupCallManager } from './groupCall.js';
import { startIceRefresh } from './iceServers.js';
import { getStoredVolume, setStoredVolume, getStoredShareVolume, setStoredShareVolume } from './volume.js';
import {
  escapeHtml, linkifyHtml, initials, avatarStyle, bannerStyle, statusLabel, statusDotClass,
  formatTime, formatDayTime, formatJoinDate, toast, el,
} from './ui.js';
import { EMOJI_CATEGORIES } from './emojiData.js';
import { ColorWheel } from './colorWheel.js';

const MAX_GROUP_MEMBERS = 10;
const DEFAULT_WHEEL_HEX = '#7c3aed';

let profileColorWheel = null;

const ringtoneAudio = new Audio('assets/ringtone.mp3');
ringtoneAudio.loop = true;
ringtoneAudio.volume = 0.85;

const state = {
  currentUser: null,
  friends: [],
  incoming: [],
  outgoing: [],
  groups: [],
  activeTab: 'friends',
  selectedType: null, // 'dm' | 'group' | null
  selectedPeerId: null,
  selectedGroupId: null,
  conversations: {}, // peerId -> { messages: [] | null, unread: number }
  groupConversations: {}, // groupId -> { messages: [] | null, unread: number }
  callViewExpanded: true,
  pendingAutoShare: null,
  pendingGroupContext: null, // { peerId } when creating a group from an active DM call
  editingGroupId: null,
  editingMessageId: null, // id of the message currently showing its inline edit textarea
  volumePopoverTarget: null, // userId currently shown in the volume popover
  volumePopoverMode: 'voice', // 'voice' | 'share'
  focusedShareId: null, // 'self' | userId — which of possibly several simultaneous screen shares is in the big stage
  contextMenuUser: null, // full user object the avatar-context-menu is currently pointed at
  friendsFilter: 'online', // 'online' | 'all' | 'pending'
  dmSearch: '',
};

const dom = {
  onboarding: document.getElementById('onboarding-screen'),
  authRegisterView: document.getElementById('auth-register-view'),
  authLoginView: document.getElementById('auth-login-view'),
  registerUsername: document.getElementById('register-username'),
  registerPassword: document.getElementById('register-password'),
  registerPasswordConfirm: document.getElementById('register-password-confirm'),
  registerSubmit: document.getElementById('register-submit'),
  registerError: document.getElementById('register-error'),
  showLoginBtn: document.getElementById('show-login-btn'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginSubmit: document.getElementById('login-submit'),
  loginError: document.getElementById('login-error'),
  showRegisterBtn: document.getElementById('show-register-btn'),
  logoutBtn: document.getElementById('logout-btn'),

  mainApp: document.getElementById('main-app'),
  chatUnreadDot: document.getElementById('chat-unread-dot'),
  railHome: document.getElementById('rail-home'),
  railGroups: document.getElementById('rail-groups'),
  sidebarHome: document.getElementById('sidebar-home'),
  sidebarGroup: document.getElementById('sidebar-group'),
  sidebarGroupHeader: document.getElementById('sidebar-group-header'),
  sidebarGroupName: document.getElementById('sidebar-group-name'),
  sidebarGroupBody: document.getElementById('sidebar-group-body'),
  sidebarFriendsBtn: document.getElementById('sidebar-friends-btn'),
  friendsPendingBadge: document.getElementById('friends-pending-badge'),
  dmSearch: document.getElementById('dm-search'),
  userPanelMe: document.getElementById('user-panel-me'),
  userPanelAvatar: document.getElementById('user-panel-avatar'),
  userPanelDot: document.getElementById('user-panel-dot'),
  userPanelName: document.getElementById('user-panel-name'),
  userPanelStatus: document.getElementById('user-panel-status'),
  userPanelMic: document.getElementById('user-panel-mic'),
  userPanelDeafen: document.getElementById('user-panel-deafen'),
  userPanelSettings: document.getElementById('user-panel-settings'),
  asidePanel: document.getElementById('aside-panel'),

  friendsFilter: document.getElementById('friends-filter'),
  pendingCount: document.getElementById('pending-count'),
  toggleAddFriend: document.getElementById('toggle-add-friend'),
  addFriendPanel: document.getElementById('add-friend-panel'),
  onlineSection: document.getElementById('online-section'),
  offlineSection: document.getElementById('offline-section'),
  friendsEmptyTitle: document.getElementById('friends-empty-title'),
  friendsEmptySub: document.getElementById('friends-empty-sub'),

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

  profileBanner: document.getElementById('profile-banner'),
  profileBannerEdit: document.getElementById('profile-banner-edit'),
  profileAvatar: document.getElementById('profile-avatar'),
  profileAvatarEdit: document.getElementById('profile-avatar-edit'),
  profileNameInput: document.getElementById('profile-name-input'),
  profileTagInput: document.getElementById('profile-tag-input'),
  statusOptions: document.getElementById('status-options'),
  profileBioInput: document.getElementById('profile-bio-input'),
  profileColorWheel: document.getElementById('profile-color-wheel'),
  profileColorBrightness: document.getElementById('profile-color-brightness'),
  profileColorHex: document.getElementById('profile-color-hex'),
  profileColorSwatch: document.getElementById('profile-color-swatch'),
  profileColorReset: document.getElementById('profile-color-reset'),
  profileCard: document.querySelector('#tab-profile .profile-card'),
  profileSaveBtn: document.getElementById('profile-save-btn'),
  profileSaveHint: document.getElementById('profile-save-hint'),

  dmListItems: document.getElementById('dm-list-items'),
  dmListEmpty: document.getElementById('dm-list-empty'),
  dmNewGroupBtn: document.getElementById('dm-new-group-btn'),
  chatMain: document.getElementById('chat-main'),
  chatEmpty: document.getElementById('chat-empty'),
  chatTextView: document.getElementById('chat-text-view'),
  chatHeader: document.getElementById('chat-header'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  chatSendBtn: document.getElementById('chat-send-btn'),
  emojiPickerBtn: document.getElementById('emoji-picker-btn'),
  emojiPickerPanel: document.getElementById('emoji-picker-panel'),
  emojiPickerTabs: document.getElementById('emoji-picker-tabs'),
  emojiPickerGrid: document.getElementById('emoji-picker-grid'),

  callBar: document.getElementById('call-bar'),
  callBarTitle: document.getElementById('call-bar-title'),
  callBarTimer: document.getElementById('call-bar-timer'),
  callBarMic: document.getElementById('call-bar-mic'),
  callBarShare: document.getElementById('call-bar-share'),
  callBarGroup: document.getElementById('call-bar-group'),
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

  incomingGroupModal: document.getElementById('incoming-group-call-modal'),
  incomingGroupAvatar: document.getElementById('incoming-group-avatar'),
  incomingGroupName: document.getElementById('incoming-group-name'),
  incomingGroupSub: document.getElementById('incoming-group-sub'),
  incomingGroupAccept: document.getElementById('incoming-group-accept'),
  incomingGroupDecline: document.getElementById('incoming-group-decline'),

  pickerModal: document.getElementById('screenshare-picker-modal'),
  pickerSources: document.getElementById('picker-sources'),
  pickerCancel: document.getElementById('picker-cancel'),

  createGroupModal: document.getElementById('create-group-modal'),
  createGroupName: document.getElementById('create-group-name'),
  createGroupMax: document.getElementById('create-group-max'),
  createGroupFriends: document.getElementById('create-group-friends'),
  createGroupCancel: document.getElementById('create-group-cancel'),
  createGroupConfirm: document.getElementById('create-group-confirm'),

  groupSettingsModal: document.getElementById('group-settings-modal'),
  groupSettingsAvatar: document.getElementById('group-settings-avatar'),
  groupSettingsAvatarEdit: document.getElementById('group-settings-avatar-edit'),
  groupSettingsName: document.getElementById('group-settings-name'),
  groupSettingsMembers: document.getElementById('group-settings-members'),
  groupSettingsAddEmpty: document.getElementById('group-settings-add-empty'),
  groupSettingsAddMax: document.getElementById('group-settings-add-max'),
  groupSettingsAddFriends: document.getElementById('group-settings-add-friends'),
  groupSettingsCancel: document.getElementById('group-settings-cancel'),
  groupSettingsSave: document.getElementById('group-settings-save'),
  groupSettingsDelete: document.getElementById('group-settings-delete'),

  avatarContextMenu: document.getElementById('avatar-context-menu'),
  actxViewProfile: document.getElementById('actx-view-profile'),
  actxVolumeSection: document.getElementById('actx-volume-section'),
  volumePopoverName: document.getElementById('volume-popover-name'),
  volumeSlider: document.getElementById('volume-slider'),
  volumePopoverValue: document.getElementById('volume-popover-value'),

  userProfileModal: document.getElementById('user-profile-modal'),
  userProfileCard: document.getElementById('user-profile-card'),
  userProfileClose: document.getElementById('user-profile-close'),
  userProfileBanner: document.getElementById('user-profile-banner'),
  userProfileAvatar: document.getElementById('user-profile-avatar'),
  userProfileStatusDot: document.getElementById('user-profile-status-dot'),
  userProfileName: document.getElementById('user-profile-name'),
  userProfileTag: document.getElementById('user-profile-tag'),
  userProfileStatusLabel: document.getElementById('user-profile-status-label'),
  userProfileBioSection: document.getElementById('user-profile-bio-section'),
  userProfileBio: document.getElementById('user-profile-bio'),
  userProfileMemberSince: document.getElementById('user-profile-member-since'),
  userProfileMessageBtn: document.getElementById('user-profile-message-btn'),
  userProfileFriendBtn: document.getElementById('user-profile-friend-btn'),
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
  group: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8" r="2.8"/><path d="M3 19c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5"/><circle cx="16.5" cy="8.5" r="2.2"/><path d="M15 14.3c2.3.3 4 2.2 4 4.7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.15-1.4l2-1.4-1.5-2.6-2.3.8a7 7 0 0 0-2.4-1.4L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2.4 1.4l-2.3-.8-1.5 2.6 2 1.4A7 7 0 0 0 5 12c0 .5.05.9.15 1.4l-2 1.4 1.5 2.6 2.3-.8a7 7 0 0 0 2.4 1.4l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2.4-1.4l2.3.8 1.5-2.6-2-1.4c.1-.5.15-.9.15-1.4Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  chatBubble: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5c0-1.4 1.1-2.5 2.5-2.5h11c1.4 0 2.5 1.1 2.5 2.5v8c0 1.4-1.1 2.5-2.5 2.5H10l-4.5 4v-4H6.5C5.1 17 4 15.9 4 14.5v-8Z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5L3 8Z"/></svg>',
  moreVertical: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
};

// ---------------- Boot ----------------
window.orbit.screenShare.onPickRequest((sources) => showScreenSharePicker(sources));
window.orbit.hotkey.onToggleMute(() => activeCallManager()?.toggleMic());
window.orbit.update.onStatus(({ state }) => {
  if (state === 'available') toast('Baixando atualização em segundo plano...');
  if (state === 'ready') toast('Atualização pronta — reinicie o Orbit para aplicar.', 'ok');
});

boot();

async function boot() {
  wireAuth();
  wireStaticHandlers();
  callManager.onUpdate(onCallUpdate);
  groupCallManager.onUpdate(onGroupCallUpdate);
  setInterval(tickTimers, 1000);
  requestAnimationFrame(speakingLoop);

  const saved = await window.orbit.session.load();
  if (saved && saved.id) {
    try {
      const res = await emit('auth:session', { id: saved.id });
      onLoggedIn(res);
      return;
    } catch {
      await window.orbit.session.clear();
    }
  }
  dom.onboarding.hidden = false;
  showAuthView('register');
}

// ---------------- Auth (create account / log in) ----------------
function showAuthView(view) {
  dom.authRegisterView.hidden = view !== 'register';
  dom.authLoginView.hidden = view !== 'login';
  dom.registerError.hidden = true;
  dom.loginError.hidden = true;
  if (view === 'register') {
    dom.registerUsername.value = '';
    dom.registerPassword.value = '';
    dom.registerPasswordConfirm.value = '';
    dom.registerSubmit.disabled = true;
    dom.registerUsername.focus();
  } else {
    dom.loginUsername.value = '';
    dom.loginPassword.value = '';
    dom.loginSubmit.disabled = true;
    dom.loginUsername.focus();
  }
}

function wireAuth() {
  const updateRegisterDisabled = () => {
    dom.registerSubmit.disabled = !(
      dom.registerUsername.value.trim().length >= 2
      && dom.registerPassword.value.length >= 6
      && dom.registerPasswordConfirm.value.length >= 6
    );
  };
  [dom.registerUsername, dom.registerPassword, dom.registerPasswordConfirm].forEach((input) => {
    input.addEventListener('input', updateRegisterDisabled);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !dom.registerSubmit.disabled) submitRegister();
    });
  });
  dom.registerSubmit.addEventListener('click', submitRegister);
  dom.showLoginBtn.addEventListener('click', () => showAuthView('login'));

  const updateLoginDisabled = () => {
    dom.loginSubmit.disabled = !(dom.loginUsername.value.trim().length > 0 && dom.loginPassword.value.length > 0);
  };
  [dom.loginUsername, dom.loginPassword].forEach((input) => {
    input.addEventListener('input', updateLoginDisabled);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !dom.loginSubmit.disabled) submitLogin();
    });
  });
  dom.loginSubmit.addEventListener('click', submitLogin);
  dom.showRegisterBtn.addEventListener('click', () => showAuthView('register'));

  dom.logoutBtn.addEventListener('click', logout);
}

async function submitRegister() {
  const username = dom.registerUsername.value.trim();
  const password = dom.registerPassword.value;
  const confirmPassword = dom.registerPasswordConfirm.value;
  if (!username || password.length < 6) return;
  if (password !== confirmPassword) {
    dom.registerError.textContent = 'As senhas digitadas não são iguais.';
    dom.registerError.hidden = false;
    return;
  }
  dom.registerSubmit.disabled = true;
  dom.registerError.hidden = true;
  try {
    const res = await emit('auth:register', { username, password, confirmPassword });
    await window.orbit.session.save({ id: res.user.id });
    onLoggedIn(res);
  } catch (err) {
    const messages = {
      invalid_username: 'Escolha um nome de usuário com pelo menos 2 caracteres.',
      invalid_password: 'A senha deve ter pelo menos 6 caracteres.',
      password_mismatch: 'As senhas digitadas não são iguais.',
      username_taken: 'Esse nome de usuário já está em uso. Escolha outro.',
    };
    dom.registerError.textContent = messages[err.message] || 'Não foi possível criar sua conta. Tente novamente.';
    dom.registerError.hidden = false;
    dom.registerSubmit.disabled = false;
  }
}

async function submitLogin() {
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;
  if (!username || !password) return;
  dom.loginSubmit.disabled = true;
  dom.loginError.hidden = true;
  try {
    const res = await emit('auth:login', { username, password });
    await window.orbit.session.save({ id: res.user.id });
    onLoggedIn(res);
  } catch (err) {
    dom.loginError.textContent = err.message === 'invalid_credentials'
      ? 'Usuário ou senha incorretos.'
      : 'Não foi possível entrar. Tente novamente.';
    dom.loginError.hidden = false;
    dom.loginSubmit.disabled = false;
  }
}

async function logout() {
  callManager.endCall();
  groupCallManager.leaveCall();
  await window.orbit.session.clear();
  socket.disconnect();
  socket.connect();

  Object.assign(state, {
    currentUser: null,
    friends: [],
    incoming: [],
    outgoing: [],
    groups: [],
    activeTab: 'friends',
    selectedType: null,
    selectedPeerId: null,
    selectedGroupId: null,
    conversations: {},
    groupConversations: {},
    callViewExpanded: true,
    pendingAutoShare: null,
    pendingGroupContext: null,
    editingGroupId: null,
    editingMessageId: null,
    volumePopoverTarget: null,
    volumePopoverMode: 'voice',
    focusedShareId: null,
    contextMenuUser: null,
    friendsFilter: 'online',
    dmSearch: '',
  });
  dom.dmSearch.value = '';

  dom.mainApp.hidden = true;
  dom.onboarding.hidden = false;
  showAuthView('login');
}

// ---------------- Login ----------------
async function onLoggedIn(res) {
  startIceRefresh(res.iceServers);
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

  try {
    const groupsRes = await emit('groups:list');
    state.groups = groupsRes.groups;
    renderDmList();
  } catch { /* ignore */ }
}

let realtimeBound = false;
function bindRealtimeEvents() {
  // The socket is reused (disconnect+reconnect) across a logout/login cycle
  // within the same app session, so these listeners must only ever be wired
  // once — they read live `state.*` on every call, not a stale snapshot.
  if (realtimeBound) return;
  realtimeBound = true;
  on('presence:update', ({ userId, status }) => {
    const friend = state.friends.find((f) => f.id === userId);
    if (friend) friend.status = status;
    renderFriends();
    renderDmList();
    if (state.selectedType === 'dm' && state.selectedPeerId === userId) renderChatHeaderIfSelected();
  });

  on('friend:profile', (user) => {
    const idx = state.friends.findIndex((f) => f.id === user.id);
    if (idx >= 0) state.friends[idx] = { ...state.friends[idx], ...user };
    renderFriends();
    renderDmList();
    if (state.selectedType === 'dm' && state.selectedPeerId === user.id) renderChatHeaderIfSelected();
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
    if (state.activeTab === 'chat' && state.selectedType === 'dm' && state.selectedPeerId === peerId) {
      renderChatMessages();
    } else {
      conv.unread += 1;
    }
    renderDmList();
    updateNavUnreadDot();
  });

  on('message:edited', (message) => applyMessageEdit(message));

  on('group:created', (group) => {
    if (!state.groups.some((g) => g.id === group.id)) state.groups.push(group);
    else state.groups = state.groups.map((g) => (g.id === group.id ? group : g));
    renderDmList();
  });

  on('group:updated', (group) => {
    const idx = state.groups.findIndex((g) => g.id === group.id);
    if (idx >= 0) state.groups[idx] = group; else state.groups.push(group);
    renderDmList();
    if (state.selectedType === 'group' && state.selectedGroupId === group.id) renderChatMain();
  });

  on('group:deleted', ({ groupId }) => {
    state.groups = state.groups.filter((g) => g.id !== groupId);
    delete state.groupConversations[groupId];
    if (groupCallManager.groupId === groupId) groupCallManager.leaveCall();
    if (state.selectedType === 'group' && state.selectedGroupId === groupId) {
      state.selectedType = null;
      state.selectedGroupId = null;
      toast('Este grupo foi excluído');
    }
    renderDmList();
    if (state.activeTab === 'chat') renderChatMain();
  });

  // Who's currently on a group's call — kept live for every member, even
  // people not on the call themselves, so leaving/joining always reflects
  // correctly instead of only being visible from inside the call view.
  on('call:group-roster', ({ groupId, participantIds }) => {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) return;
    group.activeCallMemberIds = participantIds;
    renderDmList();
    if (state.selectedType === 'group' && state.selectedGroupId === groupId && !isCallViewShowing()) {
      renderGroupChatHeader(group);
    }
  });

  on('group:message:receive', (message) => {
    const groupId = message.groupId;
    const conv = state.groupConversations[groupId] || (state.groupConversations[groupId] = { messages: null, unread: 0 });
    if (conv.messages === null) conv.messages = [];
    conv.messages.push(message);
    if (state.activeTab === 'chat' && state.selectedType === 'group' && state.selectedGroupId === groupId) {
      renderGroupChatMessages();
    } else {
      conv.unread += 1;
    }
    renderDmList();
    updateNavUnreadDot();
  });
}

// ---------------- Tabs ----------------
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
  renderDmList();
  renderUserPanel();
}

// Groups get their own unread badges on the rail; the home orbit's dot only
// tracks direct messages.
function updateNavUnreadDot() {
  dom.chatUnreadDot.hidden = !Object.values(state.conversations).some((c) => c.unread > 0);
}

function openDm(peerId) {
  switchTab('chat');
  selectConversation(peerId);
}

function openGroup(groupId) {
  switchTab('chat');
  selectGroupConversation(groupId);
}

function toggleMicFromPanel() {
  const cm = activeCallManager();
  if (!cm || cm.state !== 'connected') { toast('Você não está em uma chamada'); return; }
  cm.toggleMic();
}

function toggleDeafenFromPanel() {
  const cm = activeCallManager();
  if (!cm || cm.state !== 'connected') { toast('Você não está em uma chamada'); return; }
  cm.toggleDeafen();
}

async function pickImageOrToast(kind) {
  const result = await window.orbit.avatar.pick(kind);
  if (!result) return null;
  if (result.error === 'too_large') { toast('Arquivo muito grande (máx. 8MB)', 'err'); return null; }
  return result.dataUrl || null;
}

function wireStaticHandlers() {
  // Navigation: rail, sidebar, user panel
  dom.railHome.addEventListener('click', () => switchTab('friends'));
  dom.sidebarFriendsBtn.addEventListener('click', () => switchTab('friends'));
  dom.userPanelMe.addEventListener('click', () => switchTab('profile'));
  dom.userPanelSettings.addEventListener('click', () => switchTab('profile'));
  dom.userPanelMic.addEventListener('click', toggleMicFromPanel);
  dom.userPanelDeafen.addEventListener('click', toggleDeafenFromPanel);
  dom.dmSearch.addEventListener('input', () => {
    state.dmSearch = dom.dmSearch.value.trim().toLowerCase();
    renderDmList();
  });
  dom.sidebarGroupHeader.addEventListener('click', () => {
    const group = currentGroup(state.selectedGroupId);
    if (group) openGroupSettingsModal(group);
  });

  // Friends
  dom.friendsFilter.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.friendsFilter = btn.dataset.filter;
      renderFriends();
    });
  });
  dom.toggleAddFriend.addEventListener('click', () => {
    dom.addFriendPanel.hidden = !dom.addFriendPanel.hidden;
    if (!dom.addFriendPanel.hidden) dom.addFriendInput.focus();
  });
  dom.addFriendBtn.addEventListener('click', submitAddFriend);
  dom.addFriendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAddFriend();
  });

  // Profile
  dom.profileAvatarEdit.addEventListener('click', async () => {
    const dataUrl = await pickImageOrToast('avatar');
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

  dom.profileBannerEdit.addEventListener('click', async () => {
    const dataUrl = await pickImageOrToast('banner');
    if (!dataUrl) return;
    try {
      const res = await emit('profile:update', { banner: { type: 'image', dataUrl } });
      state.currentUser = res.user;
      renderProfile();
      toast('Banner atualizado', 'ok');
    } catch {
      toast('Não foi possível atualizar o banner', 'err');
    }
  });

  profileColorWheel = new ColorWheel(dom.profileColorWheel, {
    onChange: (hex, committed) => {
      syncColorPreview(hex);
      if (committed) saveProfileColor(hex);
    },
  });
  dom.profileColorBrightness.addEventListener('input', () => {
    profileColorWheel.setValue(Number(dom.profileColorBrightness.value));
    syncColorPreview(profileColorWheel.hex());
  });
  dom.profileColorBrightness.addEventListener('change', () => {
    saveProfileColor(profileColorWheel.hex());
  });
  dom.profileColorReset.addEventListener('click', () => {
    // The card goes back to the real theme default (no inline override) —
    // the wheel/swatch/hex box just reset to a neutral starting point for
    // the next time someone wants to pick a custom color.
    profileColorWheel.setFromHex(DEFAULT_WHEEL_HEX);
    dom.profileColorBrightness.value = String(Math.round(profileColorWheel.value));
    dom.profileColorSwatch.style.backgroundColor = profileColorWheel.hex();
    dom.profileColorHex.value = profileColorWheel.hex().replace('#', '').toUpperCase();
    dom.profileCard.style.backgroundColor = '';
    saveProfileColor(null);
  });

  dom.profileColorHex.addEventListener('input', () => {
    const hex = `#${dom.profileColorHex.value.trim()}`;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    profileColorWheel.setFromHex(hex);
    dom.profileColorBrightness.value = String(Math.round(profileColorWheel.value));
    syncColorPreview(hex, false);
  });
  const commitHexInput = () => {
    const hex = `#${dom.profileColorHex.value.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(hex)) saveProfileColor(hex.toLowerCase());
    else syncColorPreview(profileColorWheel.hex());
  };
  dom.profileColorHex.addEventListener('change', commitHexInput);
  dom.profileColorHex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dom.profileColorHex.blur();
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
    const tagRaw = dom.profileTagInput.value.trim();
    if (!username) { toast('O nome não pode ficar vazio', 'err'); return; }
    if (!/^\d{1,4}$/.test(tagRaw)) { toast('A tag deve ter de 1 a 4 números', 'err'); return; }
    try {
      const res = await emit('profile:update', { username, statusMessage, tag: tagRaw });
      state.currentUser = res.user;
      renderProfile();
      dom.profileSaveHint.textContent = 'Alterações salvas';
      dom.profileSaveHint.classList.add('show');
      setTimeout(() => dom.profileSaveHint.classList.remove('show'), 2200);
    } catch (err) {
      const messages = {
        invalid_tag: 'A tag deve ter de 1 a 4 números.',
        username_taken: 'Esse nome de usuário já está em uso por outra pessoa.',
      };
      toast(messages[err.message] || 'Não foi possível salvar o perfil', 'err');
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
  wireEmojiPicker();

  document.addEventListener('click', (e) => {
    if (e.target.closest('.msg-actions')) return;
    dom.chatMessages.querySelectorAll('.msg-actions-menu').forEach((m) => { m.hidden = true; });
  });

  // Conversas: start a group directly, without needing an active call
  dom.dmNewGroupBtn.addEventListener('click', () => openCreateGroupModal());

  // Incoming DM call modal
  dom.incomingAccept.addEventListener('click', () => callManager.acceptIncoming());
  dom.incomingDecline.addEventListener('click', () => callManager.declineIncoming());

  // Incoming group call modal
  dom.incomingGroupAccept.addEventListener('click', () => groupCallManager.acceptIncoming());
  dom.incomingGroupDecline.addEventListener('click', () => groupCallManager.declineIncoming());

  // Call bar
  dom.callBarMic.addEventListener('click', () => activeCallManager()?.toggleMic());
  dom.callBarShare.addEventListener('click', () => activeCallManager()?.toggleScreenShare());
  dom.callBarGroup.addEventListener('click', () => openCreateGroupModal());
  dom.callBarEnd.addEventListener('click', () => endActiveCall());

  // Screen share picker
  dom.pickerCancel.addEventListener('click', () => {
    window.orbit.screenShare.choose(null);
    dom.pickerModal.hidden = true;
  });

  // Create group modal
  dom.createGroupCancel.addEventListener('click', closeCreateGroupModal);
  dom.createGroupConfirm.addEventListener('click', confirmCreateGroup);

  // Group settings modal
  dom.groupSettingsCancel.addEventListener('click', closeGroupSettingsModal);
  dom.groupSettingsSave.addEventListener('click', confirmGroupSettings);
  dom.groupSettingsDelete.addEventListener('click', deleteCurrentGroup);
  dom.groupSettingsAvatarEdit.addEventListener('click', async () => {
    const dataUrl = await pickImageOrToast('avatar');
    if (!dataUrl) return;
    dom.groupSettingsAvatar.style.cssText = `background-image:url('${dataUrl}');`;
    dom.groupSettingsAvatar.textContent = '';
    dom.groupSettingsAvatar.dataset.pendingIcon = dataUrl;
  });

  // Avatar right-click context menu: "Perfil de Usuário" always, plus (only
  // inside a call) that person's voice/share volume slider underneath.
  dom.actxViewProfile.addEventListener('click', () => {
    const user = state.contextMenuUser;
    closeAvatarContextMenu();
    if (user) openUserProfile(user);
  });
  dom.volumeSlider.addEventListener('input', () => {
    if (!state.volumePopoverTarget) return;
    const pct = Number(dom.volumeSlider.value);
    dom.volumePopoverValue.textContent = `${pct}%`;
    const volume = pct / 100;
    if (state.volumePopoverMode === 'share') setStoredShareVolume(state.volumePopoverTarget, volume);
    else setStoredVolume(state.volumePopoverTarget, volume);
    applyLiveVolume(state.volumePopoverTarget, volume, state.volumePopoverMode);
  });
  document.addEventListener('mousedown', (e) => {
    if (!dom.avatarContextMenu.hidden && !dom.avatarContextMenu.contains(e.target)) closeAvatarContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.avatarContextMenu.hidden) closeAvatarContextMenu();
  });

  // User profile viewer
  dom.userProfileClose.addEventListener('click', closeUserProfile);
  dom.userProfileModal.addEventListener('click', (e) => {
    if (e.target === dom.userProfileModal) closeUserProfile();
  });
}

function applyLiveVolume(userId, volume, mode) {
  if (mode === 'share') {
    if (callManager.state !== 'idle' && callManager.peer && callManager.peer.id === userId) {
      callManager.setRemoteShareVolume(volume);
    }
    if (groupCallManager.state !== 'idle') {
      groupCallManager.setPeerShareVolume(volume);
    }
    return;
  }
  if (callManager.state !== 'idle' && callManager.peer && callManager.peer.id === userId) {
    callManager.setRemoteVolume(volume);
  }
  if (groupCallManager.state !== 'idle') {
    groupCallManager.setPeerVolume(userId, volume);
  }
}

// volumeMode: null (just the profile item) or 'voice'/'share' (also shows
// that person's call volume slider — only meaningful from inside a call).
function openAvatarContextMenu(evt, user, volumeMode = null) {
  evt.preventDefault();
  evt.stopPropagation();
  state.contextMenuUser = user;
  state.volumePopoverTarget = volumeMode ? user.id : null;
  state.volumePopoverMode = volumeMode || 'voice';

  dom.actxVolumeSection.hidden = !volumeMode;
  if (volumeMode) {
    const stored = volumeMode === 'share' ? getStoredShareVolume(user.id) : getStoredVolume(user.id);
    const pct = Math.round(stored * 100);
    dom.volumePopoverName.textContent = volumeMode === 'share' ? `Transmissão de ${user.username || 'Usuário'}` : (user.username || 'Usuário');
    dom.volumeSlider.value = String(pct);
    dom.volumePopoverValue.textContent = `${pct}%`;
  }

  dom.avatarContextMenu.hidden = false;
  const left = Math.min(evt.clientX, window.innerWidth - 220);
  const top = Math.min(evt.clientY, window.innerHeight - (volumeMode ? 160 : 60));
  dom.avatarContextMenu.style.left = `${Math.max(8, left)}px`;
  dom.avatarContextMenu.style.top = `${Math.max(8, top)}px`;
}

function closeAvatarContextMenu() {
  dom.avatarContextMenu.hidden = true;
  state.contextMenuUser = null;
  state.volumePopoverTarget = null;
  state.volumePopoverMode = 'voice';
}

// ---------------- User profile viewer ----------------
function openUserProfile(user) {
  dom.userProfileCard.style.backgroundColor = user.profileColor || '';
  dom.userProfileStatusDot.style.borderColor = user.profileColor || '';
  dom.userProfileBanner.style.cssText = bannerStyle(user);
  dom.userProfileAvatar.style.cssText = avatarStyle(user);
  dom.userProfileAvatar.textContent = avatarInner(user);
  dom.userProfileStatusDot.className = `status-dot user-profile-status-dot ${statusDotClass(user.status)}`;
  dom.userProfileName.textContent = user.username;
  dom.userProfileTag.textContent = `#${user.tag}`;
  dom.userProfileStatusLabel.textContent = user.status === 'offline' ? 'Offline' : statusLabel(user.status);

  const bio = user.statusMessage && user.statusMessage.trim();
  dom.userProfileBioSection.hidden = !bio;
  if (bio) dom.userProfileBio.textContent = bio;

  dom.userProfileMemberSince.textContent = formatJoinDate(user.createdAt);

  const isSelf = state.currentUser && user.id === state.currentUser.id;
  const relation = isSelf ? 'self' : friendshipStatusWith(user.id);

  dom.userProfileMessageBtn.hidden = relation !== 'friend';
  dom.userProfileMessageBtn.onclick = () => {
    closeUserProfile();
    switchTab('chat');
    selectConversation(user.id);
  };

  dom.userProfileFriendBtn.hidden = !['none', 'outgoing', 'incoming'].includes(relation);
  if (relation === 'none') {
    dom.userProfileFriendBtn.textContent = 'Adicionar Amigo';
    dom.userProfileFriendBtn.disabled = false;
    dom.userProfileFriendBtn.className = 'btn btn-primary btn-block';
    dom.userProfileFriendBtn.onclick = () => sendFriendRequestFromProfile(user);
  } else if (relation === 'outgoing') {
    dom.userProfileFriendBtn.textContent = 'Pedido de amizade enviado';
    dom.userProfileFriendBtn.disabled = true;
    dom.userProfileFriendBtn.className = 'btn btn-ghost btn-block';
    dom.userProfileFriendBtn.onclick = null;
  } else if (relation === 'incoming') {
    dom.userProfileFriendBtn.textContent = 'Aceitar pedido de amizade';
    dom.userProfileFriendBtn.disabled = false;
    dom.userProfileFriendBtn.className = 'btn btn-primary btn-block';
    dom.userProfileFriendBtn.onclick = () => acceptFriendRequestFromProfile(user);
  }

  dom.userProfileModal.hidden = false;
}

function friendshipStatusWith(userId) {
  if (state.friends.some((f) => f.id === userId)) return 'friend';
  if (state.outgoing.some((f) => f.id === userId)) return 'outgoing';
  if (state.incoming.some((f) => f.id === userId)) return 'incoming';
  return 'none';
}

async function sendFriendRequestFromProfile(user) {
  dom.userProfileFriendBtn.disabled = true;
  try {
    const res = await emit('friend:request', { username: user.username, tag: user.tag });
    if (!state.outgoing.some((f) => f.id === res.target.id)) state.outgoing.push(res.target);
    renderFriends();
    toast(`Pedido enviado para ${res.target.username}#${res.target.tag}`, 'ok');
    openUserProfile(user);
  } catch (err) {
    const messages = {
      already_friends: 'Vocês já são amigos.',
      already_pending: 'Já existe um pedido de amizade entre vocês.',
    };
    toast(messages[err.message] || 'Não foi possível enviar o pedido.', 'err');
    dom.userProfileFriendBtn.disabled = false;
  }
}

async function acceptFriendRequestFromProfile(user) {
  const pending = state.incoming.find((f) => f.id === user.id);
  if (!pending) return;
  dom.userProfileFriendBtn.disabled = true;
  try {
    await emit('friend:respond', { friendshipId: pending.friendshipId, accept: true });
    const res = await emit('friends:list');
    state.friends = res.friends;
    state.incoming = res.incoming;
    state.outgoing = res.outgoing;
    renderFriends();
    renderDmList();
    toast(`Você e ${user.username} agora são amigos`, 'ok');
    openUserProfile(user);
  } catch {
    toast('Não foi possível aceitar o pedido.', 'err');
    dom.userProfileFriendBtn.disabled = false;
  }
}

function closeUserProfile() {
  dom.userProfileModal.hidden = true;
}

// Looks up a full user object (avatar/banner/status/createdAt/...) from
// whatever list already has it loaded, for the "Perfil de Usuário"
// right-click — friends, pending requests, or a group's member list.
function findKnownUser(id) {
  if (state.currentUser && state.currentUser.id === id) return state.currentUser;
  for (const list of [state.friends, state.incoming, state.outgoing]) {
    const found = list.find((u) => u.id === id);
    if (found) return found;
  }
  for (const group of state.groups) {
    const found = group.members.find((m) => m.id === id);
    if (found) return found;
  }
  return null;
}

// Wires "Perfil de Usuário" (no volume section) on every element carrying
// data-profile="<userId>" inside the given container — call this after
// (re)rendering that container's innerHTML.
function wireProfileContextMenus(container) {
  container.querySelectorAll('[data-profile]').forEach((el) => {
    el.addEventListener('contextmenu', (e) => {
      const user = findKnownUser(el.dataset.profile);
      if (user) openAvatarContextMenu(e, user, null);
    });
  });
}

function activeCallManager() {
  if (callManager.state !== 'idle') return callManager;
  if (groupCallManager.state !== 'idle') return groupCallManager;
  return null;
}

function endActiveCall() {
  if (callManager.state !== 'idle') callManager.endCall();
  else if (groupCallManager.state !== 'idle') groupCallManager.leaveCall();
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

  const filter = state.friendsFilter;
  dom.friendsFilter.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  const pendingTotal = state.incoming.length;
  dom.pendingCount.hidden = pendingTotal === 0;
  dom.pendingCount.textContent = String(pendingTotal);
  dom.friendsPendingBadge.hidden = pendingTotal === 0;
  dom.friendsPendingBadge.textContent = String(pendingTotal);

  dom.pendingSection.hidden = filter !== 'pending' || state.incoming.length === 0;
  dom.outgoingSection.hidden = filter !== 'pending' || state.outgoing.length === 0;
  dom.onlineSection.hidden = filter === 'pending' || online.length === 0;
  dom.offlineSection.hidden = filter !== 'all' || offline.length === 0;

  let empty = null;
  if (filter === 'pending') {
    if (state.incoming.length + state.outgoing.length === 0) {
      empty = ['Nenhum pedido pendente', 'Pedidos de amizade que você enviar ou receber aparecem aqui.'];
    }
  } else if (state.friends.length === 0) {
    empty = ['Você ainda não tem amigos por aqui.', 'Clique em <strong>Adicionar amigo</strong> e use o nome e a tag, como <strong>usuario#0001</strong>.'];
  } else if (filter === 'online' && online.length === 0) {
    empty = ['Ninguém online agora', 'Seus amigos aparecem aqui assim que ficarem online. Veja todos em <strong>Todos</strong>.'];
  }
  dom.friendsEmptyState.hidden = !empty;
  if (empty) {
    dom.friendsEmptyTitle.textContent = empty[0];
    dom.friendsEmptySub.innerHTML = empty[1];
  }

  dom.pendingList.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', () => respondFriendRequest(btn.dataset.accept, true));
  });
  dom.pendingList.querySelectorAll('[data-decline]').forEach((btn) => {
    btn.addEventListener('click', () => respondFriendRequest(btn.dataset.decline, false));
  });
  dom.outgoingList.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => cancelOutgoingRequest(btn.dataset.cancel));
  });
  const friendsTab = document.getElementById('tab-friends');
  friendsTab.querySelectorAll('[data-chat-with]').forEach((btn) => {
    btn.addEventListener('click', () => openDm(btn.dataset.chatWith));
  });
  friendsTab.querySelectorAll('[data-call-with]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const friend = state.friends.find((f) => f.id === btn.dataset.callWith);
      if (!friend) return;
      openDm(friend.id);
      requestCall(friend);
    });
  });
  renderAside();

  wireProfileContextMenus(document.getElementById('tab-friends'));
}

function friendRowHtml(u) {
  const isOffline = u.status === 'offline';
  const sub = isOffline ? 'Offline' : (u.statusMessage || availabilityLabel(u.status));
  return `
  <div class="friend-row ${isOffline ? 'offline' : ''}">
    <div class="friend-row-avatar" data-profile="${u.id}">
      <div class="avatar avatar-md" style="${avatarStyle(u)}">${avatarInner(u)}</div>
      <span class="status-dot ${statusDotClass(u.status)}"></span>
    </div>
    <div class="friend-row-info">
      <div class="friend-row-name">${escapeHtml(u.username)}<span class="friend-row-tag">#${u.tag}</span></div>
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
    <div class="friend-row-avatar" data-profile="${u.id}">
      <div class="avatar avatar-md" style="${avatarStyle(u)}">${avatarInner(u)}</div>
    </div>
    <div class="friend-row-info">
      <div class="friend-row-name">${escapeHtml(u.username)}<span class="friend-row-tag">#${u.tag}</span></div>
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

// Groups reuse the same avatar rendering helpers as users — a group just
// looks like { avatar: <icon>, username: <name> } to avatarStyle/avatarInner.
function groupAsAvatarLike(group) {
  return { avatar: group.icon, username: group.name };
}

function iconChat() {
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5c0-1.4 1.1-2.5 2.5-2.5h11c1.4 0 2.5 1.1 2.5 2.5v8c0 1.4-1.1 2.5-2.5 2.5H10l-4.5 4v-4H6.5C5.1 17 4 15.9 4 14.5v-8Z"/></svg>';
}

// ---------------- Profile tab ----------------
function renderProfile() {
  const u = state.currentUser;
  if (!u) return;
  dom.profileBanner.style.cssText = bannerStyle(u);
  dom.profileAvatar.style.cssText = avatarStyle(u);
  dom.profileAvatar.textContent = avatarInner(u);
  dom.profileNameInput.value = u.username;
  dom.profileTagInput.value = u.tag;
  dom.statusOptions.querySelectorAll('.status-option').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.status === u.status);
  });
  dom.profileBioInput.value = u.statusMessage || '';

  dom.profileCard.style.backgroundColor = u.profileColor || '';
  if (profileColorWheel) {
    profileColorWheel.setFromHex(u.profileColor || DEFAULT_WHEEL_HEX);
    dom.profileColorBrightness.value = String(Math.round(profileColorWheel.value));
    syncColorPreview(profileColorWheel.hex());
  }
  // The wheel always shows a color, but the card only takes one once the
  // person actually picked it.
  dom.profileCard.style.backgroundColor = u.profileColor || '';
  renderUserPanel();
}

function availabilityLabel(status) {
  if (status === 'online') return 'Disponível';
  if (status === 'invisible') return 'Invisível';
  return statusLabel(status);
}

// Bottom-left "you" panel. Mic/deafen mirror the active call and look idle
// when there's no call to act on.
function renderUserPanel() {
  const u = state.currentUser;
  if (!u) return;
  dom.userPanelAvatar.style.cssText = avatarStyle(u);
  dom.userPanelAvatar.textContent = avatarInner(u);
  dom.userPanelDot.className = `status-dot ${statusDotClass(u.status === 'invisible' ? 'offline' : u.status)}`;
  dom.userPanelName.textContent = u.username;
  dom.userPanelStatus.textContent = u.statusMessage || availabilityLabel(u.status);

  const cm = activeCallManager();
  const live = !!cm && cm.state === 'connected';
  const muted = live && cm.micMuted;
  const deafened = live && cm.deafened;
  dom.userPanelMic.innerHTML = muted ? ICONS.micOff : ICONS.mic;
  dom.userPanelMic.classList.toggle('is-off', muted);
  dom.userPanelMic.classList.toggle('is-idle', !live);
  dom.userPanelDeafen.innerHTML = ICONS.headphones;
  dom.userPanelDeafen.classList.toggle('is-off', deafened);
  dom.userPanelDeafen.classList.toggle('is-idle', !live);
  dom.userPanelSettings.innerHTML = ICONS.gear;
  dom.userPanelSettings.classList.toggle('active', state.activeTab === 'profile');
}

function syncColorPreview(hex, updateHexInput = true) {
  dom.profileColorSwatch.style.backgroundColor = hex;
  dom.profileCard.style.backgroundColor = hex;
  if (updateHexInput) dom.profileColorHex.value = hex.replace('#', '').toUpperCase();
}

async function saveProfileColor(color) {
  try {
    const res = await emit('profile:update', { profileColor: color });
    state.currentUser = res.user;
  } catch {
    toast('Não foi possível salvar a cor do perfil', 'err');
  }
}

// ---------------- Navigation: rail, sidebar, right column ----------------
// The sidebar shows a group's own panel only while that group's chat is open;
// everywhere else (friends, profile, DMs) it's the home list.
function viewingGroup() {
  return state.activeTab === 'chat' && state.selectedType === 'group' ? currentGroup(state.selectedGroupId) : null;
}

// Name kept from when this only drew the DM list: it's called after nearly
// every state change, so it now refreshes all navigation chrome at once.
function renderDmList() {
  if (!state.currentUser) return;
  const group = viewingGroup();
  renderRail(group);
  dom.sidebarHome.hidden = !!group;
  dom.sidebarGroup.hidden = !group;
  if (group) renderGroupSidebar(group); else renderHomeSidebar();
  renderAside();
}

function renderRail(activeGroup) {
  dom.railHome.classList.toggle('active', !activeGroup);
  dom.railGroups.innerHTML = state.groups.map((g) => {
    const conv = state.groupConversations[g.id];
    const unread = conv ? conv.unread : 0;
    const live = (g.activeCallMemberIds || []).length > 0;
    const groupLike = groupAsAvatarLike(g);
    let marker = '';
    if (unread > 0) marker = `<span class="rail-badge">${unread > 99 ? '99+' : unread}</span>`;
    else if (live) marker = `<span class="rail-live">${ICONS.speaker.replace(/width="18" height="18"/, 'width="11" height="11"')}</span>`;
    return `
      <button class="rail-group ${activeGroup && activeGroup.id === g.id ? 'active' : ''}" data-rail-group="${g.id}" title="${escapeHtml(g.name)}">
        <div class="avatar" style="${avatarStyle(groupLike)}">${avatarInner(groupLike)}</div>
        ${marker}
      </button>`;
  }).join('');
  dom.railGroups.querySelectorAll('[data-rail-group]').forEach((btn) => {
    btn.addEventListener('click', () => openGroup(btn.dataset.railGroup));
  });
}

function renderHomeSidebar() {
  dom.sidebarFriendsBtn.classList.toggle('active', state.activeTab === 'friends');
  const rows = state.friends
    .filter((f) => !state.dmSearch || f.username.toLowerCase().includes(state.dmSearch))
    .map((f) => {
      const conv = state.conversations[f.id];
      const lastMsg = conv && conv.messages && conv.messages.length ? conv.messages[conv.messages.length - 1] : null;
      return { id: f.id, entity: f, lastMsg, unread: conv ? conv.unread : 0 };
    });
  rows.sort((a, b) => (b.lastMsg?.createdAt || 0) - (a.lastMsg?.createdAt || 0));

  dom.dmListEmpty.hidden = rows.length > 0;
  dom.dmListEmpty.textContent = state.dmSearch
    ? 'Nenhuma conversa encontrada.'
    : 'Adicione amigos para começar a conversar.';
  dom.dmListItems.innerHTML = rows.map(dmRowHtml).join('');
  dom.dmListItems.querySelectorAll('[data-peer]').forEach((rowEl) => {
    rowEl.addEventListener('click', () => openDm(rowEl.dataset.peer));
  });
  wireProfileContextMenus(dom.dmListItems);
}

function dmRowHtml({ id, entity: friend, lastMsg, unread }) {
  const preview = lastMsg
    ? `${lastMsg.from === state.currentUser.id ? 'Você: ' : ''}${escapeHtml(lastMsg.text)}`
    : escapeHtml(friend.status === 'offline' ? 'Offline' : (friend.statusMessage || availabilityLabel(friend.status)));
  const inCall = callManager.state !== 'idle' && callManager.peer && callManager.peer.id === friend.id;
  const selected = state.activeTab === 'chat' && state.selectedType === 'dm' && state.selectedPeerId === id;
  return `
  <div class="dm-row ${selected ? 'selected' : ''} ${unread > 0 ? 'unread' : ''}" data-peer="${id}">
    <div class="dm-row-avatar" data-profile="${id}">
      <div class="avatar avatar-md" style="${avatarStyle(friend)}">${avatarInner(friend)}</div>
      <span class="status-dot ${statusDotClass(friend.status)}"></span>
    </div>
    <div class="dm-row-info">
      <div class="dm-row-name">${escapeHtml(friend.username)}</div>
      <div class="dm-row-preview">${inCall ? '<span class="dm-row-live">Em chamada</span>' : preview}</div>
    </div>
    ${unread > 0 ? `<div class="dm-row-meta"><div class="dm-row-unread">${unread}</div></div>` : ''}
  </div>`;
}

function groupCallMembers(group) {
  return (group.activeCallMemberIds || [])
    .map((id) => (id === state.currentUser.id ? state.currentUser : group.members.find((m) => m.id === id)))
    .filter(Boolean);
}

function renderGroupSidebar(group) {
  dom.sidebarGroupName.textContent = group.name;
  const inThisCall = groupCallManager.state !== 'idle' && groupCallManager.groupId === group.id;
  const callMembers = groupCallMembers(group);
  dom.sidebarGroupBody.innerHTML = `
    <div class="side-label">Conversa</div>
    <button class="side-item active" data-group-chat>
      ${ICONS.chatBubble}<span>Chat do grupo</span>
    </button>
    <div class="side-label">Chamada de voz</div>
    <button class="side-item ${inThisCall ? 'has-unread' : ''}" data-group-voice title="${inThisCall ? 'Abrir chamada' : (callMembers.length ? 'Entrar na chamada' : 'Iniciar chamada')}">
      ${ICONS.speaker}<span>Sala de voz</span>${callMembers.length ? '<span class="live-dot"></span>' : ''}
    </button>
    ${callMembers.length ? `<div class="voice-roster">${callMembers.map((u) => `
      <div class="voice-roster-item" data-profile="${u.id}">
        <div class="avatar" style="${avatarStyle(u)}">${avatarInner(u)}</div>
        <span>${escapeHtml(u.username)}</span>
      </div>`).join('')}</div>` : ''}`;

  dom.sidebarGroupBody.querySelector('[data-group-chat]').addEventListener('click', () => {
    if (isCallViewShowing()) state.callViewExpanded = false;
    renderChatMain();
  });
  dom.sidebarGroupBody.querySelector('[data-group-voice]').addEventListener('click', () => requestGroupCall(group));
  wireProfileContextMenus(dom.sidebarGroupBody);
}

// ---------------- Right column ----------------
function renderAside() {
  if (!state.currentUser) return;
  const tab = state.activeTab;
  dom.asidePanel.hidden = tab === 'profile';
  dom.mainApp.classList.toggle('no-aside', dom.asidePanel.hidden);
  if (tab === 'friends') { renderActivityAside(); return; }
  if (tab !== 'chat') return;
  if (state.selectedType === 'group') {
    const group = currentGroup(state.selectedGroupId);
    if (group) { renderGroupMembersAside(group); return; }
  }
  if (state.selectedType === 'dm') {
    const friend = currentFriend(state.selectedPeerId);
    if (friend) { renderPeerAside(friend); return; }
  }
  renderActivityAside();
}

// "Ativo agora": every group call you could hop into, plus your own call.
function renderActivityAside() {
  const cards = [];

  if (callManager.state !== 'idle' && callManager.peer) {
    const peer = callManager.peer;
    cards.push(`
      <div class="activity-card">
        <div class="activity-card-head">
          <div class="avatar avatar-md" style="${avatarStyle(peer)}">${avatarInner(peer)}</div>
          <div>
            <div class="activity-card-name">${escapeHtml(peer.username)}</div>
            <div class="activity-card-sub">${callManager.state === 'connected' ? 'Em chamada com você' : 'Chamando...'}</div>
          </div>
        </div>
        <div class="activity-card-room">
          <span class="activity-card-room-name">Chamada privada</span>
          <button class="btn btn-primary btn-small" data-open-call>Abrir</button>
        </div>
      </div>`);
  }

  state.groups.forEach((g) => {
    const members = groupCallMembers(g);
    if (members.length === 0) return;
    const inIt = groupCallManager.state !== 'idle' && groupCallManager.groupId === g.id;
    const first = members[0];
    const sharing = inIt && (groupCallManager.sharingLocal || groupCallManager.participantList().some((p) => p.remoteSharing));
    cards.push(`
      <div class="activity-card">
        <div class="activity-card-head">
          <div class="avatar avatar-md" style="${avatarStyle(first)}" data-profile="${first.id}">${avatarInner(first)}</div>
          <div>
            <div class="activity-card-name">${escapeHtml(first.id === state.currentUser.id ? 'Você' : first.username)}${members.length > 1 ? ` e mais ${members.length - 1}` : ''}</div>
            <div class="activity-card-sub">${sharing ? 'Compartilhando a tela' : 'Em chamada de voz'}</div>
          </div>
        </div>
        <div class="activity-card-room">
          <span class="activity-card-room-name">${escapeHtml(g.name)}</span>
          <button class="btn btn-primary btn-small" data-join-group="${g.id}">${inIt ? 'Abrir' : 'Entrar'}</button>
        </div>
      </div>`);
  });

  dom.asidePanel.innerHTML = `
    <div class="aside-title">Ativo agora</div>
    ${cards.length ? cards.join('') : `
      <div class="aside-empty">
        <strong>Tudo quieto por aqui</strong>
        Quando alguém começar uma chamada em um grupo seu, ela aparece aqui pra você entrar.
      </div>`}`;

  const openBtn = dom.asidePanel.querySelector('[data-open-call]');
  if (openBtn) openBtn.addEventListener('click', () => { state.callViewExpanded = true; renderChatMain(); });
  dom.asidePanel.querySelectorAll('[data-join-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = currentGroup(btn.dataset.joinGroup);
      if (!group) return;
      openGroup(group.id);
      requestGroupCall(group);
    });
  });
  wireProfileContextMenus(dom.asidePanel);
}

function renderPeerAside(friend) {
  const bio = friend.statusMessage && friend.statusMessage.trim();
  dom.asidePanel.innerHTML = `
    <div class="peer-card" style="${friend.profileColor ? `background-color:${friend.profileColor};` : ''}">
      <div class="peer-card-banner" style="${bannerStyle(friend)}"></div>
      <div class="peer-card-body">
        <div class="peer-card-avatar" data-profile="${friend.id}">
          <div class="avatar" style="${avatarStyle(friend)}${friend.profileColor ? `box-shadow:0 0 0 5px ${friend.profileColor};` : ''}">${avatarInner(friend)}</div>
          <span class="status-dot ${statusDotClass(friend.status)}" style="${friend.profileColor ? `border-color:${friend.profileColor};` : ''}"></span>
        </div>
        <div class="peer-card-name">${escapeHtml(friend.username)}</div>
        <div class="peer-card-tag">#${friend.tag} · ${friend.status === 'offline' ? 'Offline' : availabilityLabel(friend.status)}</div>
        ${bio ? `<div class="peer-card-section"><div class="peer-card-section-title">Sobre</div><div>${escapeHtml(bio)}</div></div>` : ''}
        <div class="peer-card-section"><div class="peer-card-section-title">Membro desde</div><div>${formatJoinDate(friend.createdAt)}</div></div>
      </div>
    </div>`;
  wireProfileContextMenus(dom.asidePanel);
}

function memberStatus(member) {
  if (member.id === state.currentUser.id) return state.currentUser.status === 'invisible' ? 'offline' : state.currentUser.status;
  const friend = state.friends.find((f) => f.id === member.id);
  return (friend || member).status || 'offline';
}

function renderGroupMembersAside(group) {
  const members = group.members.map((m) => {
    const fresh = m.id === state.currentUser.id ? state.currentUser : (state.friends.find((f) => f.id === m.id) || m);
    return { ...m, ...fresh, status: memberStatus(m) };
  });
  const online = members.filter((m) => m.status !== 'offline');
  const offline = members.filter((m) => m.status === 'offline');
  const inCall = new Set(group.activeCallMemberIds || []);
  const row = (m) => `
    <div class="member-row ${m.status === 'offline' ? 'offline' : ''}" data-profile="${m.id}">
      <div class="member-row-avatar">
        <div class="avatar avatar-md" style="${avatarStyle(m)}">${avatarInner(m)}</div>
        <span class="status-dot ${statusDotClass(m.status)}"></span>
      </div>
      <div style="min-width:0;">
        <div class="member-row-name">${escapeHtml(m.username)}${m.id === group.createdBy ? `<span class="member-row-crown" title="Criou o grupo">${ICONS.crown}</span>` : ''}</div>
        <div class="member-row-sub">${inCall.has(m.id) ? 'Na sala de voz' : escapeHtml(m.status === 'offline' ? 'Offline' : (m.statusMessage || availabilityLabel(m.status)))}</div>
      </div>
    </div>`;
  dom.asidePanel.innerHTML = `
    ${online.length ? `<div class="aside-members-block"><div class="section-label">Online — ${online.length}</div>${online.map(row).join('')}</div>` : ''}
    ${offline.length ? `<div class="aside-members-block"><div class="section-label">Offline — ${offline.length}</div>${offline.map(row).join('')}</div>` : ''}`;
  wireProfileContextMenus(dom.asidePanel);
}

function memberName(group, userId) {
  if (userId === state.currentUser.id) return 'Você';
  const member = group.members.find((m) => m.id === userId);
  return member ? member.username : 'Alguém';
}

async function selectConversation(peerId) {
  state.selectedType = 'dm';
  state.selectedPeerId = peerId;
  state.selectedGroupId = null;
  state.editingMessageId = null;
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

async function selectGroupConversation(groupId) {
  state.selectedType = 'group';
  state.selectedGroupId = groupId;
  state.selectedPeerId = null;
  state.editingMessageId = null;
  const conv = state.groupConversations[groupId] || (state.groupConversations[groupId] = { messages: null, unread: 0 });
  if (conv.messages === null) {
    try {
      const res = await emit('group:messages:history', { groupId });
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
  if (state.activeTab === 'chat' && state.selectedType && !isCallViewShowing()) renderChatMain();
}

function isCallViewShowing() {
  return activeCallManager() !== null && state.callViewExpanded;
}

function currentFriend(peerId) {
  return state.friends.find((f) => f.id === peerId) || null;
}

function currentGroup(groupId) {
  return state.groups.find((g) => g.id === groupId) || null;
}

function renderChatMain() {
  const cm = activeCallManager();
  const callActive = cm !== null;
  dom.callBar.hidden = !callActive || state.callViewExpanded;
  if (callActive) renderCallBar(cm);
  renderUserPanel();

  if (callActive && state.callViewExpanded) {
    dom.callView.hidden = false;
    if (cm === callManager) renderCallView(); else renderGroupCallView();
    return;
  }

  dom.callView.hidden = true;

  if (state.selectedType === 'group') {
    const group = currentGroup(state.selectedGroupId);
    if (!group) { dom.chatEmpty.hidden = false; dom.chatTextView.hidden = true; return; }
    dom.chatEmpty.hidden = true;
    dom.chatTextView.hidden = false;
    renderGroupChatHeader(group);
    renderGroupChatMessages();
    return;
  }

  if (state.selectedType === 'dm') {
    const friend = currentFriend(state.selectedPeerId);
    if (!friend) { dom.chatEmpty.hidden = false; dom.chatTextView.hidden = true; return; }
    dom.chatEmpty.hidden = true;
    dom.chatTextView.hidden = false;
    renderChatHeader(friend);
    renderChatMessages();
    return;
  }

  dom.chatEmpty.hidden = false;
  dom.chatTextView.hidden = true;
}

function renderChatHeader(friend) {
  dom.chatInput.placeholder = `Conversar com ${friend.username}`;
  const inCallWithFriend = callManager.state !== 'idle' && callManager.peer && callManager.peer.id === friend.id;
  dom.chatHeader.innerHTML = `
    <div class="chat-header-user">
      <div class="chat-header-avatar" data-profile="${friend.id}">
        <div class="avatar avatar-sm" style="${avatarStyle(friend)}">${avatarInner(friend)}</div>
        <span class="status-dot ${statusDotClass(friend.status)}"></span>
      </div>
      <div class="chat-header-name">${escapeHtml(friend.username)}</div>
      <div class="chat-header-divider"></div>
      <div class="chat-header-status">${escapeHtml(friend.status === 'offline' ? 'Offline' : (friend.statusMessage || availabilityLabel(friend.status)))}</div>
    </div>
    <div class="chat-header-actions">
      <button class="icon-btn" id="chat-call-btn" title="Chamada de voz">${ICONS.phone}</button>
      <button class="icon-btn" id="chat-share-btn" title="Compartilhar tela">${ICONS.monitor}</button>
    </div>`;

  document.getElementById('chat-call-btn').addEventListener('click', () => requestCall(friend));
  document.getElementById('chat-share-btn').addEventListener('click', () => requestScreenShare(friend));
  wireProfileContextMenus(dom.chatHeader);

  if (inCallWithFriend) {
    document.getElementById('chat-call-btn').classList.add('active');
  }
}

function renderGroupChatHeader(group) {
  const groupLike = groupAsAvatarLike(group);
  const inCallWithGroup = groupCallManager.state !== 'idle' && groupCallManager.groupId === group.id;
  const callMembers = (group.activeCallMemberIds || [])
    .map((id) => (id === state.currentUser.id ? state.currentUser : group.members.find((m) => m.id === id)))
    .filter(Boolean);
  const statusHtml = callMembers.length > 0
    ? `<div class="chat-header-call-roster">
        <div class="call-roster-avatars">${callMembers.slice(0, 4).map((u) => `<div class="avatar avatar-xs" style="${avatarStyle(u)}" title="${escapeHtml(u.username)}">${avatarInner(u)}</div>`).join('')}</div>
        <span>Em chamada · ${callMembers.length}</span>
      </div>`
    : `${group.members.length} membros`;
  dom.chatInput.placeholder = `Conversar em ${group.name}`;
  dom.chatHeader.innerHTML = `
    <div class="chat-header-user">
      <div class="chat-header-avatar">
        <div class="avatar avatar-sm" style="${avatarStyle(groupLike)}">${avatarInner(groupLike)}</div>
      </div>
      <div class="chat-header-name">${escapeHtml(group.name)}</div>
      <div class="chat-header-divider"></div>
      <div class="chat-header-status">${statusHtml}</div>
    </div>
    <div class="chat-header-actions">
      <button class="icon-btn" id="chat-group-call-btn" title="${inCallWithGroup ? 'Voltar para a chamada' : (callMembers.length > 0 ? 'Entrar na chamada' : 'Chamada de voz')}">${ICONS.phone}</button>
      <button class="icon-btn" id="chat-group-share-btn" title="Compartilhar tela">${ICONS.monitor}</button>
      <button class="icon-btn" id="chat-group-settings-btn" title="Configurações do grupo">${ICONS.gear}</button>
    </div>`;

  document.getElementById('chat-group-call-btn').addEventListener('click', () => requestGroupCall(group));
  document.getElementById('chat-group-share-btn').addEventListener('click', () => requestGroupScreenShare(group));
  document.getElementById('chat-group-settings-btn').addEventListener('click', () => openGroupSettingsModal(group));

  if (inCallWithGroup) document.getElementById('chat-group-call-btn').classList.add('active');
}

function requestCall(friend) {
  if (groupCallManager.state !== 'idle') { toast('Você já está em uma chamada em grupo'); return; }
  if (callManager.state !== 'idle') {
    if (callManager.peer && callManager.peer.id === friend.id) {
      state.callViewExpanded = true;
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
  if (callManager.state !== 'idle' || groupCallManager.state !== 'idle') {
    toast('Você já está em uma chamada');
    return;
  }
  state.pendingAutoShare = friend.id;
  state.callViewExpanded = true;
  callManager.startCall(friend);
}

function requestGroupCall(group) {
  if (callManager.state !== 'idle') { toast('Encerre a chamada atual primeiro'); return; }
  if (groupCallManager.state !== 'idle') {
    if (groupCallManager.groupId === group.id) { state.callViewExpanded = true; renderChatMain(); }
    else toast('Você já está em uma chamada em grupo');
    return;
  }
  state.callViewExpanded = true;
  if (group.activeCallMemberIds && group.activeCallMemberIds.length > 0) {
    groupCallManager.joinActiveCall(group);
  } else {
    groupCallManager.startGroupCall(group);
  }
}

function requestGroupScreenShare(group) {
  if (groupCallManager.state === 'connected' && groupCallManager.groupId === group.id) {
    state.callViewExpanded = true;
    groupCallManager.toggleScreenShare();
    return;
  }
  requestGroupCall(group);
}

// ---------------- Messages ----------------
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function renderChatMessages() {
  const conv = state.conversations[state.selectedPeerId];
  const friend = currentFriend(state.selectedPeerId);
  renderMessageList((conv && conv.messages) || [], () => friend);
}

function renderGroupChatMessages() {
  const group = currentGroup(state.selectedGroupId);
  const conv = state.groupConversations[state.selectedGroupId];
  renderMessageList((conv && conv.messages) || [], (m) => (group ? group.members.find((mem) => mem.id === m.from) : null));
}

// Shared by DMs and groups: day dividers, and consecutive messages from the
// same person within a few minutes collapse under a single avatar/name.
function renderMessageList(messages, authorOf) {
  let html = '';
  let prev = null;
  messages.forEach((m) => {
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    if (newDay) html += `<div class="day-divider">${dayLabel(m.createdAt)}</div>`;
    const continued = !newDay && prev.from === m.from && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
    const mine = m.from === state.currentUser.id;
    html += messageRowHtml(m, mine ? state.currentUser : authorOf(m), mine, continued);
    prev = m;
  });
  dom.chatMessages.innerHTML = html;
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  wireMessageLinks();
  wireProfileContextMenus(dom.chatMessages);
  wireMessageActions(dom.chatMessages);
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(ts) === dayKey(now)) return 'Hoje';
  if (dayKey(ts) === dayKey(yesterday)) return 'Ontem';
  const d = new Date(ts);
  const opts = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('pt-BR', opts);
}

// Your own messages carry the edit menu, or — while state.editingMessageId
// matches — an inline textarea in place of the text.
function messageRowHtml(m, author, mine, continued) {
  const editing = mine && state.editingMessageId === m.id;
  const lead = continued
    ? `<div class="msg-gutter"><div class="msg-gutter-time">${formatTime(m.createdAt)}</div></div>`
    : `<div class="avatar msg-avatar" style="${author ? avatarStyle(author) : ''}" ${author ? `data-profile="${author.id}"` : ''}>${author ? avatarInner(author) : ''}</div>`;
  const meta = continued ? '' : `
      <div class="msg-meta"><span class="msg-author">${escapeHtml(author ? author.username : 'Alguém')}</span><span class="msg-time">${formatTime(m.createdAt)}</span></div>`;
  const body = editing
    ? `<div class="msg-edit-wrap">
        <textarea class="msg-edit-input" rows="1">${escapeHtml(m.text)}</textarea>
        <div class="msg-edit-hint">Enter para salvar · Esc para cancelar</div>
      </div>`
    : `<div class="msg-text">${linkifyHtml(m.text)}${editedTagHtml(m)}</div>`;
  const actions = mine && !editing ? `
      <div class="msg-actions">
        <button class="msg-actions-btn" title="Mais opções">${ICONS.moreVertical}</button>
        <div class="msg-actions-menu" hidden>
          <button class="msg-actions-item" data-action="edit">Editar mensagem</button>
        </div>
      </div>` : '';
  return `
    <div class="msg-row ${mine ? 'msg-row-out' : ''} ${continued ? 'continued' : ''}" ${mine ? `data-msg-id="${m.id}"` : ''}>
      ${lead}
      <div class="msg-body">${meta}${body}</div>
      ${actions}
    </div>`;
}

function editedTagHtml(m) {
  return m.editedAt ? ' <span class="msg-edited-tag">(editada)</span>' : '';
}

function wireMessageActions(container) {
  container.querySelectorAll('.msg-actions-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const wasHidden = menu.hidden;
      container.querySelectorAll('.msg-actions-menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !wasHidden;
    });
  });
  container.querySelectorAll('.msg-actions-item[data-action="edit"]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = item.closest('.msg-row');
      startEditingMessage(row.dataset.msgId);
    });
  });
  const editWrap = container.querySelector('.msg-edit-wrap');
  if (editWrap) wireMessageEditInput(editWrap.querySelector('.msg-edit-input'));
}

function startEditingMessage(id) {
  state.editingMessageId = id;
  if (state.selectedType === 'group') renderGroupChatMessages(); else renderChatMessages();
}

function cancelEditingMessage() {
  state.editingMessageId = null;
  if (state.selectedType === 'group') renderGroupChatMessages(); else renderChatMessages();
}

function wireMessageEditInput(input) {
  if (!input) return;
  const autoGrow = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  autoGrow();
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessageEdit(state.editingMessageId, input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingMessage();
    }
  });
}

async function submitMessageEdit(id, text) {
  const trimmed = text.trim();
  if (!trimmed) { toast('A mensagem não pode ficar vazia', 'err'); return; }
  state.editingMessageId = null;
  try {
    const res = await emit('message:edit', { id, text: trimmed });
    applyMessageEdit(res.message);
  } catch {
    toast('Não foi possível editar a mensagem', 'err');
    if (state.selectedType === 'group') renderGroupChatMessages(); else renderChatMessages();
  }
}

function applyMessageEdit(message) {
  if (message.groupId) {
    const conv = state.groupConversations[message.groupId];
    const idx = conv && conv.messages ? conv.messages.findIndex((m) => m.id === message.id) : -1;
    if (idx >= 0) conv.messages[idx] = message;
    if (state.selectedType === 'group' && state.selectedGroupId === message.groupId) renderGroupChatMessages();
  } else {
    const peerId = message.from === state.currentUser.id ? message.to : message.from;
    const conv = state.conversations[peerId];
    const idx = conv && conv.messages ? conv.messages.findIndex((m) => m.id === message.id) : -1;
    if (idx >= 0) conv.messages[idx] = message;
    if (state.selectedType === 'dm' && state.selectedPeerId === peerId) renderChatMessages();
  }
}

// Links in chat must never navigate this window (see main.js's
// will-navigate guard) — always hand them to the OS's default browser.
function wireEmojiPicker() {
  dom.emojiPickerTabs.innerHTML = EMOJI_CATEGORIES.map((cat, i) => `
    <button type="button" class="emoji-picker-tab${i === 0 ? ' active' : ''}" data-cat="${i}" title="${escapeHtml(cat.label)}">${cat.icon}</button>
  `).join('');

  const renderCategory = (index) => {
    dom.emojiPickerTabs.querySelectorAll('.emoji-picker-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
    });
    const cat = EMOJI_CATEGORIES[index];
    dom.emojiPickerGrid.innerHTML = `
      <div class="emoji-picker-category-label">${escapeHtml(cat.label)}</div>
      ${cat.emojis.map((em) => `<button type="button" class="emoji-picker-item">${em}</button>`).join('')}
    `;
    dom.emojiPickerGrid.scrollTop = 0;
  };

  dom.emojiPickerTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker-tab');
    if (!btn) return;
    renderCategory(Number(btn.dataset.cat));
  });

  dom.emojiPickerGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker-item');
    if (!btn) return;
    insertAtCursor(dom.chatInput, btn.textContent);
  });

  dom.emojiPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dom.emojiPickerPanel.hidden;
    dom.emojiPickerPanel.hidden = !willOpen;
    if (willOpen) renderCategory(0);
  });

  document.addEventListener('click', (e) => {
    if (dom.emojiPickerPanel.hidden) return;
    if (e.target === dom.emojiPickerBtn || dom.emojiPickerBtn.contains(e.target)) return;
    if (dom.emojiPickerPanel.contains(e.target)) return;
    dom.emojiPickerPanel.hidden = true;
  });
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const cursor = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  textarea.dispatchEvent(new Event('input'));
}

function wireMessageLinks() {
  dom.chatMessages.querySelectorAll('a[data-ext-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.orbit.external.open(a.getAttribute('href'));
    });
  });
}

async function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || !state.selectedType) return;
  dom.chatInput.value = '';
  dom.chatInput.style.height = 'auto';

  if (state.selectedType === 'group') {
    const groupId = state.selectedGroupId;
    try {
      const res = await emit('group:message:send', { groupId, text });
      const conv = state.groupConversations[groupId] || (state.groupConversations[groupId] = { messages: [], unread: 0 });
      if (conv.messages === null) conv.messages = [];
      conv.messages.push(res.message);
      renderGroupChatMessages();
      renderDmList();
    } catch {
      toast('Não foi possível enviar a mensagem', 'err');
    }
    return;
  }

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

// ---------------- DM call UI ----------------
function onCallUpdate(cm) {
  if (cm.state === 'connected' && state.pendingAutoShare && cm.peer && cm.peer.id === state.pendingAutoShare) {
    state.pendingAutoShare = null;
    cm.toggleScreenShare();
  }
  if (cm.state === 'idle') { state.pendingAutoShare = null; state.focusedShareId = null; closeAvatarContextMenu(); }

  updateRingtone();
  renderIncomingModal();
  renderChatMain();
  renderDmList();
}

function updateRingtone() {
  const ringing = callManager.state === 'ringing' || groupCallManager.state === 'ringing';
  if (ringing) {
    if (ringtoneAudio.paused) ringtoneAudio.play().catch(() => {});
  } else if (!ringtoneAudio.paused) {
    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;
  }
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

// ---------------- Group call UI ----------------
function onGroupCallUpdate() {
  if (groupCallManager.state === 'idle') { state.focusedShareId = null; closeAvatarContextMenu(); }
  updateRingtone();
  renderIncomingGroupModal();
  renderChatMain();
  renderDmList();
}

function renderIncomingGroupModal() {
  const ringing = groupCallManager.state === 'ringing';
  dom.incomingGroupModal.hidden = !ringing;
  if (!ringing || !groupCallManager.group) return;
  const groupLike = groupAsAvatarLike(groupCallManager.group);
  dom.incomingGroupAvatar.style.cssText = avatarStyle(groupLike);
  dom.incomingGroupAvatar.textContent = avatarInner(groupLike);
  dom.incomingGroupName.textContent = groupCallManager.group.name;
  const fromName = groupCallManager.ringingFrom ? groupCallManager.ringingFrom.username : 'Alguém';
  dom.incomingGroupSub.textContent = `${fromName} iniciou uma chamada em grupo`;
}

function renderCallBar(cm) {
  const isGroup = cm === groupCallManager;
  let title = 'Chamada';
  if (isGroup) {
    title = cm.group ? cm.group.name : 'Chamada em grupo';
  } else {
    const peer = cm.peer;
    const label = cm.state === 'calling' ? 'Chamando...' : (peer ? peer.username : '');
    title = peer ? (label || peer.username) : 'Chamada';
  }
  dom.callBarTitle.textContent = title;
  dom.callBarTimer.textContent = cm.state === 'connected' ? formatDuration(cm.elapsedSeconds()) : '';
  dom.callBarMic.innerHTML = cm.micMuted ? ICONS.micOff : ICONS.mic;
  dom.callBarMic.classList.toggle('is-off', cm.micMuted);
  dom.callBarShare.innerHTML = ICONS.monitor;
  dom.callBarShare.classList.toggle('active', cm.sharingLocal);
  dom.callBarShare.style.display = cm.state === 'connected' ? '' : 'none';
  dom.callBarMic.style.display = cm.state === 'connected' ? '' : 'none';
  // Escalating to a group only makes sense from a 1:1 call, and only while
  // there's still room to add people.
  const canEscalate = !isGroup && cm.state === 'connected';
  dom.callBarGroup.innerHTML = ICONS.group;
  dom.callBarGroup.style.display = canEscalate ? '' : 'none';
  dom.callBarExpand.innerHTML = ICONS.expand;
  dom.callBarExpand.onclick = () => { state.callViewExpanded = true; renderChatMain(); };
  dom.callBarEnd.innerHTML = ICONS.phoneEnd;
}

// ---------------- Screen share stage (supports multiple simultaneous shares) ----------------
// Returns everyone currently sharing their screen in this call — could be
// just you, just the other person/people, or several at once in a group.
function collectShares(cm) {
  const shares = [];
  if (cm.sharingLocal) shares.push({ id: 'self', user: state.currentUser, stream: cm.localScreenStream, isSelf: true });
  if (cm === callManager) {
    if (cm.remoteSharing && cm.peer) shares.push({ id: cm.peer.id, user: cm.peer, stream: cm.remoteScreenStream, isSelf: false });
  } else {
    cm.participantList().forEach((p) => {
      if (p.remoteSharing) shares.push({ id: p.user.id, user: p.user, stream: p.remoteScreenStream, isSelf: false });
    });
  }
  return shares;
}

// Keeps the previously-focused share selected across re-renders; falls back
// to the first available share if that person stopped sharing (or nothing
// was focused yet).
function focusedShare(shares) {
  if (shares.length === 0) return null;
  const found = shares.find((s) => s.id === state.focusedShareId);
  if (found) return found;
  state.focusedShareId = shares[0].id;
  return shares[0];
}

function switchFocusedShare(shareId) {
  state.focusedShareId = shareId;
  closeAvatarContextMenu();
  renderChatMain();
}

// allTiles: every participant (sharing or not), used for the column of
// tiles beside the stage so non-sharers still show up there.
function renderScreenshareStage(shares, allTiles) {
  const focus = focusedShare(shares);

  const switcherHtml = shares.length > 1 ? `
    <div class="share-switcher">
      ${shares.map((s) => `
        <button class="share-switcher-btn ${focus && s.id === focus.id ? 'active' : ''}" data-share-id="${s.id}">
          <div class="avatar avatar-xs" style="${avatarStyle(s.user)}">${avatarInner(s.user)}</div>
          <span>${escapeHtml(s.isSelf ? 'Você' : (s.user.username || ''))}</span>
        </button>`).join('')}
    </div>` : '';

  const label = focus
    ? (focus.isSelf ? 'Você está compartilhando a tela' : `${escapeHtml(focus.user.username || '')} está compartilhando a tela`)
    : '';

  dom.callViewBody.innerHTML = `
    <div class="screenshare-panel">
      <div class="screenshare-main">
        <div class="screenshare-top">
          <div class="screenshare-label">${ICONS.monitor}${label}</div>
          ${switcherHtml}
        </div>
        <div class="screenshare-stage">
          <video id="screenshare-video" autoplay playsinline></video>
          ${focus ? `<div class="screenshare-owner">${escapeHtml(focus.isSelf ? 'Você' : (focus.user.username || ''))}</div>` : ''}
        </div>
      </div>
      <div class="screenshare-strip">
        ${allTiles.map((t) => {
          const isSharer = shares.some((s) => s.id === t.id);
          const isFocused = !!(focus && t.id === focus.id);
          return `
          <div class="screenshare-thumb ${isSharer ? 'is-sharer' : ''} ${isFocused ? 'is-focused' : ''}" data-speaking-key="${t.id}" ${isSharer ? `data-share-id="${t.id}"` : ''}>
            <div class="avatar" style="${avatarStyle(t.user)}">${avatarInner(t.user)}${isSharer ? `<span class="screenshare-thumb-badge">${ICONS.monitor}</span>` : ''}</div>
            <div class="screenshare-thumb-name">${tileNameHtml(t.user, t.isSelf, t.muted)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  const videoEl = document.getElementById('screenshare-video');
  if (videoEl && focus) {
    videoEl.srcObject = focus.stream;
    // Never play your own captured system audio back to yourself — you
    // already hear it natively. Only remote shares get the volume control.
    videoEl.muted = focus.isSelf;
    videoEl.volume = focus.isSelf ? 1 : Math.min(1, Math.max(0, getStoredShareVolume(focus.id)));
  }

  dom.callViewBody.querySelectorAll('[data-share-id]').forEach((btn) => {
    btn.addEventListener('click', () => switchFocusedShare(btn.dataset.shareId));
  });

  // Right-click a tile = that person's voice volume (skip yourself).
  allTiles.forEach((t) => {
    if (t.isSelf) return;
    const tileEl = dom.callViewBody.querySelector(`[data-speaking-key="${CSS.escape(t.id)}"]`);
    if (tileEl) tileEl.addEventListener('contextmenu', (e) => openAvatarContextMenu(e, t.user, 'voice'));
  });

  // Right-click the big stage = the focused share's own audio volume.
  const stageEl = dom.callViewBody.querySelector('.screenshare-stage');
  if (stageEl && focus && !focus.isSelf) {
    stageEl.addEventListener('contextmenu', (e) => openAvatarContextMenu(e, focus.user, 'share'));
  }
}

function tileNameHtml(user, isSelf, muted) {
  const name = isSelf ? `${user.username || ''} (você)` : (user.username || '');
  return `${escapeHtml(name)}${muted ? ICONS.micOff.replace(/width="18" height="18"/, 'width="15" height="15"') : ''}`;
}

function participantTileHtml(key, user, isSelf, muted, extra = '') {
  return `
    <div class="participant-tile" data-speaking-key="${key}">
      <div class="avatar avatar-lg" style="${avatarStyle(user)}">${avatarInner(user)}</div>
      <div class="participant-tile-name">${tileNameHtml(user, isSelf, muted)}</div>
      ${extra}
    </div>`;
}

function renderCallHeader(title, sub, connected, elapsed) {
  dom.callViewHeader.innerHTML = `
    <button class="call-view-back" id="cv-back" title="Voltar para a conversa">${ICONS.back}</button>
    <div class="call-view-heading">
      <div class="call-view-title">${escapeHtml(title)}</div>
      <div class="call-view-sub">${escapeHtml(sub)}</div>
    </div>
    <div class="call-view-timer">${connected ? `<span class="live-dot"></span><span class="call-view-timer-text">${formatDuration(elapsed)}</span>` : ''}</div>`;
  document.getElementById('cv-back').addEventListener('click', collapseCallToChat);
}

// Leaves the full-window stage and lands on the call's own conversation,
// with the call continuing in the sidebar's minimized bar.
function collapseCallToChat() {
  state.callViewExpanded = false;
  if (groupCallManager.state !== 'idle' && groupCallManager.groupId) {
    openGroup(groupCallManager.groupId);
  } else if (callManager.state !== 'idle' && callManager.peer && currentFriend(callManager.peer.id)) {
    openDm(callManager.peer.id);
  } else {
    renderChatMain();
  }
}

function callControlsHtml(cm, { canEscalate }) {
  return `
    <div class="call-controls-pill">
      <button class="call-control-btn ${cm.micMuted ? 'is-off' : ''}" id="cv-mic" title="${cm.micMuted ? 'Ativar microfone' : 'Silenciar microfone'}">${cm.micMuted ? ICONS.micOff : ICONS.mic}</button>
      <button class="call-control-btn ${cm.deafened ? 'is-off' : ''}" id="cv-deafen" title="${cm.deafened ? 'Voltar a ouvir' : 'Ensurdecer'}">${ICONS.headphones}</button>
      <button class="call-control-btn ${cm.sharingLocal ? 'active' : ''}" id="cv-share" title="${cm.sharingLocal ? 'Parar transmissão' : 'Compartilhar tela'}">${ICONS.monitor}</button>
      ${canEscalate ? `<button class="call-control-btn" id="cv-group" title="Adicionar pessoas (cria um grupo)">${ICONS.group}</button>` : ''}
      <button class="call-control-btn" id="cv-chat" title="Abrir conversa">${ICONS.chatBubble}</button>
      <div class="call-control-divider"></div>
      <button class="call-control-btn call-control-end" id="cv-end" title="Sair da chamada">${ICONS.phoneEnd}<span>Sair</span></button>
    </div>`;
}

function wireCallControls(cm, onEnd) {
  document.getElementById('cv-mic').addEventListener('click', () => cm.toggleMic());
  document.getElementById('cv-deafen').addEventListener('click', () => cm.toggleDeafen());
  document.getElementById('cv-share').addEventListener('click', () => cm.toggleScreenShare());
  const groupBtn = document.getElementById('cv-group');
  if (groupBtn) groupBtn.addEventListener('click', () => openCreateGroupModal());
  document.getElementById('cv-chat').addEventListener('click', collapseCallToChat);
  document.getElementById('cv-end').addEventListener('click', onEnd);
}

function renderCallView() {
  const cm = callManager;
  const peer = cm.peer;
  if (!peer) return;

  const isSharing = cm.sharingLocal || cm.remoteSharing;
  const connected = cm.state === 'connected';
  renderCallHeader(
    peer.username,
    cm.state === 'calling' ? 'Chamando...' : `Chamada privada · 2 pessoas${isSharing ? ' · tela ao vivo' : ''}`,
    connected,
    connected ? cm.elapsedSeconds() : 0,
  );

  dom.callViewBody.classList.toggle('sharing', isSharing);
  if (isSharing) {
    const allTiles = [
      { id: 'self', user: state.currentUser, isSelf: true, muted: cm.micMuted },
      { id: peer.id, user: peer, isSelf: false, muted: cm.remoteMicMuted },
    ];
    renderScreenshareStage(collectShares(cm), allTiles);
  } else {
    dom.callViewBody.innerHTML = participantTileHtml('self', state.currentUser, true, cm.micMuted)
      + participantTileHtml(peer.id, peer, false, cm.remoteMicMuted,
        cm.state === 'calling' ? '<div class="participant-tile-calling">Chamando...</div>' : '');

    const peerTileEl = dom.callViewBody.querySelector(`[data-speaking-key="${CSS.escape(peer.id)}"]`);
    if (peerTileEl) peerTileEl.addEventListener('contextmenu', (e) => openAvatarContextMenu(e, peer, 'voice'));
  }

  if (cm.state === 'calling') {
    dom.callViewControls.innerHTML = `
      <div class="call-controls-pill">
        <button class="call-control-btn call-control-end" id="cv-end" title="Cancelar">${ICONS.phoneEnd}<span>Cancelar</span></button>
      </div>`;
    document.getElementById('cv-end').addEventListener('click', () => cm.cancelOutgoing());
  } else if (connected) {
    dom.callViewControls.innerHTML = callControlsHtml(cm, { canEscalate: true });
    wireCallControls(cm, () => cm.endCall());
  } else {
    dom.callViewControls.innerHTML = '';
  }
}

function renderGroupCallView() {
  const cm = groupCallManager;
  if (!cm.group) return;
  const participants = cm.participantList();
  const isSharing = cm.sharingLocal || participants.some((p) => p.remoteSharing);
  const count = participants.length + 1;

  renderCallHeader(
    cm.group.name,
    `Grupo · ${count} ${count === 1 ? 'pessoa' : 'pessoas'}${count === 1 ? ' · esperando o pessoal' : ''}`,
    cm.state === 'connected',
    cm.elapsedSeconds(),
  );

  dom.callViewBody.classList.toggle('sharing', isSharing);
  if (isSharing) {
    const allTiles = [
      { id: 'self', user: state.currentUser, isSelf: true, muted: cm.micMuted },
      ...participants.map((p) => ({ id: p.user.id, user: p.user, isSelf: false, muted: p.micMuted })),
    ];
    renderScreenshareStage(collectShares(cm), allTiles);
  } else {
    dom.callViewBody.innerHTML = participantTileHtml('self', state.currentUser, true, cm.micMuted)
      + participants.map((p) => participantTileHtml(p.user.id, p.user, false, p.micMuted)).join('');

    participants.forEach((p) => {
      const tileEl = dom.callViewBody.querySelector(`[data-speaking-key="${CSS.escape(p.user.id)}"]`);
      if (tileEl) tileEl.addEventListener('contextmenu', (e) => openAvatarContextMenu(e, p.user, 'voice'));
    });
  }

  dom.callViewControls.innerHTML = callControlsHtml(cm, { canEscalate: false });
  wireCallControls(cm, () => cm.leaveCall());
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------------- Speaking indicator ----------------
// Runs every animation frame instead of going through the normal
// render/_notify cycle: toggling a class directly avoids re-rendering the
// whole call view (and re-mounting the screenshare <video>) dozens of
// times a second just to reflect who's currently talking.
function speakingLoop() {
  requestAnimationFrame(speakingLoop);
  if (dom.callView.hidden) return;
  const cm = activeCallManager();
  if (!cm || cm.state !== 'connected') return;

  if (cm === callManager) {
    setSpeakingClass('self', callManager.isLocalSpeaking());
    if (callManager.peer) setSpeakingClass(callManager.peer.id, callManager.isRemoteSpeaking());
  } else if (cm === groupCallManager) {
    setSpeakingClass('self', groupCallManager.isLocalSpeaking());
    groupCallManager.participantList().forEach((p) => {
      setSpeakingClass(p.user.id, groupCallManager.isPeerSpeaking(p.user.id));
    });
  }
}

function setSpeakingClass(key, speaking) {
  const tile = dom.callViewBody.querySelector(`[data-speaking-key="${CSS.escape(String(key))}"]`);
  if (!tile) return;
  tile.classList.toggle('speaking', speaking);
  const avatarEl = tile.querySelector('.avatar');
  if (avatarEl) avatarEl.classList.toggle('speaking', speaking);
}

function tickTimers() {
  const cm = activeCallManager();
  if (!cm || cm.state !== 'connected') return;
  if (!dom.callBar.hidden) dom.callBarTimer.textContent = formatDuration(cm.elapsedSeconds());
  if (!dom.callView.hidden) {
    const timerEl = dom.callViewHeader.querySelector('.call-view-timer-text');
    if (timerEl) timerEl.textContent = formatDuration(cm.elapsedSeconds());
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

// ---------------- Create group modal ----------------
// Reachable two ways: escalating an active 1:1 call (peer is pre-selected
// and locked), or directly from the Conversas header (pick everyone freely).
function openCreateGroupModal() {
  const peer = callManager.state !== 'idle' ? callManager.peer : null;
  state.pendingGroupContext = { peerId: peer ? peer.id : null };
  const maxSelectable = MAX_GROUP_MEMBERS - (peer ? 2 : 1); // self (+ locked call peer, if any) already count
  dom.createGroupMax.textContent = String(maxSelectable);
  dom.createGroupName.value = '';
  const selectable = state.friends.filter((f) => !peer || f.id !== peer.id);
  dom.createGroupFriends.innerHTML = selectable.map((f) => `
    <div class="group-member-row" data-friend="${f.id}">
      <span class="group-member-checkbox"></span>
      <div class="avatar avatar-sm" style="${avatarStyle(f)}">${avatarInner(f)}</div>
      <span class="group-member-name">${escapeHtml(f.username)}<span class="group-member-tag">#${f.tag}</span></span>
    </div>`).join('') || '<p style="color:var(--text-muted);font-size:13px;">Você não tem outros amigos para adicionar ainda.</p>';

  dom.createGroupFriends.querySelectorAll('[data-friend]').forEach((row) => {
    row.addEventListener('click', () => {
      const checkedCount = dom.createGroupFriends.querySelectorAll('.checked').length;
      const isChecked = row.classList.contains('checked');
      if (!isChecked && checkedCount >= maxSelectable) {
        toast(`Você pode adicionar até ${maxSelectable} pessoas além de vocês dois`);
        return;
      }
      row.classList.toggle('checked');
    });
  });

  dom.createGroupModal.hidden = false;
}

function closeCreateGroupModal() {
  dom.createGroupModal.hidden = true;
  state.pendingGroupContext = null;
}

async function confirmCreateGroup() {
  if (!state.pendingGroupContext) return;
  const { peerId } = state.pendingGroupContext;
  const selectedIds = [...dom.createGroupFriends.querySelectorAll('.checked')].map((row) => row.dataset.friend);
  const name = dom.createGroupName.value.trim();
  const memberIds = peerId ? [peerId, ...selectedIds] : selectedIds;

  if (memberIds.length === 0) {
    toast('Escolha pelo menos um amigo para o grupo', 'err');
    return;
  }

  try {
    const res = await emit('group:create', { name, memberIds });
    dom.createGroupModal.hidden = true;
    state.pendingGroupContext = null;
    if (!state.groups.some((g) => g.id === res.group.id)) state.groups.push(res.group);

    switchTab('chat');
    selectGroupConversation(res.group.id);

    // Only auto-join a group call when the group was created by escalating
    // an existing 1:1 call — a group started fresh from Conversas is just a
    // new conversation until someone chooses to call it.
    if (peerId && callManager.state !== 'idle') {
      callManager.endCall();
      state.callViewExpanded = true;
      groupCallManager.startGroupCall(res.group);
    }
  } catch {
    toast('Não foi possível criar o grupo', 'err');
  }
}

// ---------------- Group settings modal ----------------
function openGroupSettingsModal(group) {
  state.editingGroupId = group.id;
  const groupLike = groupAsAvatarLike(group);
  dom.groupSettingsAvatar.style.cssText = avatarStyle(groupLike);
  dom.groupSettingsAvatar.textContent = avatarInner(groupLike);
  delete dom.groupSettingsAvatar.dataset.pendingIcon;
  dom.groupSettingsName.value = group.name;
  dom.groupSettingsMembers.innerHTML = group.members.map((m) => `
    <div class="group-member-row locked">
      <div class="avatar avatar-sm" style="${avatarStyle(m)}" data-profile="${m.id}">${avatarInner(m)}</div>
      <span class="group-member-name">${escapeHtml(m.username)}<span class="group-member-tag">#${m.tag}</span></span>
    </div>`).join('');
  wireProfileContextMenus(dom.groupSettingsMembers);

  const memberIds = new Set(group.members.map((m) => m.id));
  const addable = state.friends.filter((f) => !memberIds.has(f.id));
  const roomLeft = MAX_GROUP_MEMBERS - group.members.length;
  dom.groupSettingsAddMax.textContent = String(Math.max(0, roomLeft));

  if (roomLeft > 0 && addable.length > 0) {
    dom.groupSettingsAddEmpty.hidden = true;
    dom.groupSettingsAddFriends.innerHTML = addable.map((f) => `
      <div class="group-member-row" data-friend="${f.id}">
        <span class="group-member-checkbox"></span>
        <div class="avatar avatar-sm" style="${avatarStyle(f)}">${avatarInner(f)}</div>
        <span class="group-member-name">${escapeHtml(f.username)}<span class="group-member-tag">#${f.tag}</span></span>
      </div>`).join('');
    dom.groupSettingsAddFriends.querySelectorAll('[data-friend]').forEach((row) => {
      row.addEventListener('click', () => {
        const checkedCount = dom.groupSettingsAddFriends.querySelectorAll('.checked').length;
        const isChecked = row.classList.contains('checked');
        if (!isChecked && checkedCount >= roomLeft) {
          toast(`Só há espaço para mais ${roomLeft} pessoa${roomLeft === 1 ? '' : 's'}`);
          return;
        }
        row.classList.toggle('checked');
      });
    });
  } else {
    dom.groupSettingsAddFriends.innerHTML = '';
    dom.groupSettingsAddEmpty.hidden = false;
    dom.groupSettingsAddEmpty.textContent = roomLeft <= 0
      ? `Este grupo já está no limite de ${MAX_GROUP_MEMBERS} membros.`
      : 'Todos os seus amigos já estão neste grupo. Adicione mais amigos na aba Amigos, ou pelo perfil de alguém que já esteja aqui, para poder trazê-los também.';
  }

  dom.groupSettingsDelete.hidden = group.createdBy !== state.currentUser.id;

  dom.groupSettingsModal.hidden = false;
}

function closeGroupSettingsModal() {
  dom.groupSettingsModal.hidden = true;
  state.editingGroupId = null;
}

async function deleteCurrentGroup() {
  if (!state.editingGroupId) return;
  const group = currentGroup(state.editingGroupId);
  const groupName = group ? group.name : 'este grupo';
  const sure = window.confirm(`Excluir "${groupName}" para sempre? Isso apaga o grupo e todas as mensagens dele para todo mundo. Essa ação não pode ser desfeita.`);
  if (!sure) return;
  const groupId = state.editingGroupId;
  try {
    await emit('group:delete', { groupId });
    state.groups = state.groups.filter((g) => g.id !== groupId);
    delete state.groupConversations[groupId];
    if (state.selectedType === 'group' && state.selectedGroupId === groupId) {
      state.selectedType = null;
      state.selectedGroupId = null;
    }
    closeGroupSettingsModal();
    renderDmList();
    if (state.activeTab === 'chat') renderChatMain();
    toast('Grupo excluído', 'ok');
  } catch (err) {
    toast(err.message === 'forbidden' ? 'Só quem criou o grupo pode excluí-lo' : 'Não foi possível excluir o grupo', 'err');
  }
}

async function confirmGroupSettings() {
  if (!state.editingGroupId) return;
  const name = dom.groupSettingsName.value.trim();
  if (!name) { toast('O nome do grupo não pode ficar vazio', 'err'); return; }
  const groupId = state.editingGroupId;
  const patch = { groupId, name };
  const pendingIcon = dom.groupSettingsAvatar.dataset.pendingIcon;
  if (pendingIcon) patch.icon = { type: 'image', dataUrl: pendingIcon };
  const newMemberIds = [...dom.groupSettingsAddFriends.querySelectorAll('.checked')].map((row) => row.dataset.friend);
  try {
    let res = await emit('group:update', patch);
    if (newMemberIds.length > 0) {
      res = await emit('group:add-members', { groupId, memberIds: newMemberIds });
    }
    const idx = state.groups.findIndex((g) => g.id === res.group.id);
    if (idx >= 0) state.groups[idx] = res.group; else state.groups.push(res.group);
    closeGroupSettingsModal();
    renderDmList();
    if (state.selectedType === 'group' && state.selectedGroupId === res.group.id) renderChatMain();
    toast('Grupo atualizado', 'ok');
  } catch {
    toast('Não foi possível atualizar o grupo', 'err');
  }
}
