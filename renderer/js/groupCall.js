import { emit, on } from './api.js';
import { toast } from './ui.js';
import { SpeakingTracker } from './audioLevel.js';
import { getStoredVolume } from './volume.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
function clampVolume(v) { return Math.min(1, Math.max(0, v)); }

class GroupCallManager {
  constructor() {
    this.state = 'idle'; // idle | ringing | connected
    this.groupId = null;
    this.group = null;
    this.connectedAt = null;
    this.localStream = null;
    this.micMuted = false;
    this.deafened = false;
    this.sharingLocal = false;
    this.localScreenStream = null;
    this._localSpeakingTracker = null;
    /** peerId -> { pc, user, remoteAudioStream, remoteScreenStream, screenSender, iceQueue, speakingTracker } */
    this.peers = new Map();
    /** peerId -> candidate[] — ICE candidates that arrived before _ensurePeer()
     * ran for that peer (a real race in a mesh: a peer's onicecandidate can
     * fire, and reach us, before we've processed the offer/participant-joined
     * event that would normally create its entry first). */
    this._orphanIceCandidates = new Map();
    this._listeners = [];
    this._bindSocket();
  }

  onUpdate(fn) { this._listeners.push(fn); }
  _notify() { this._listeners.forEach((fn) => fn(this)); }

  _bindSocket() {
    on('call:group-incoming', (payload) => this._onIncoming(payload));
    on('call:group-participant-joined', (payload) => this._onParticipantJoined(payload));
    on('call:group-participant-left', (payload) => this._onParticipantLeft(payload));
    on('call:group-offer', (payload) => this._onOffer(payload));
    on('call:group-answer', (payload) => this._onAnswer(payload));
    on('call:group-ice-candidate', (payload) => this._onIceCandidate(payload));
    on('screenshare:group-state', (payload) => this._onRemoteScreenState(payload));
  }

  async startGroupCall(group) {
    if (this.state !== 'idle') return;
    this.state = 'connected';
    this.group = group;
    this.groupId = group.id;
    this.connectedAt = Date.now();
    this._notify();
    try {
      await this._ensureLocalAudio();
      await emit('call:group-start', { groupId: group.id });
    } catch (err) {
      toast('Não foi possível iniciar a chamada em grupo', 'err');
      this.leaveCall();
    }
  }

  acceptIncoming() {
    if (this.state !== 'ringing' || !this.group) return;
    this._joinMesh();
  }

  // Used when the group's call roster shows people already on a call —
  // join them directly instead of startGroupCall(), which would ring
  // everyone (including the people already connected) all over again.
  joinActiveCall(group) {
    if (this.state !== 'idle') return;
    this.group = group;
    this.groupId = group.id;
    this._joinMesh();
  }

  declineIncoming() {
    if (this.state !== 'ringing') return;
    this._resetIdle();
  }

  async _joinMesh() {
    const groupId = this.groupId;
    this.state = 'connected';
    this.connectedAt = Date.now();
    this._notify();
    try {
      await this._ensureLocalAudio();
      const res = await emit('call:group-join', { groupId });
      for (const user of res.participants || []) {
        const entry = this._ensurePeer(user);
        await this._addLocalTracks(entry);
        await this._createAndSendOffer(user.id);
      }
      this._notify();
    } catch (err) {
      toast('Não foi possível entrar na chamada em grupo', 'err');
      this.leaveCall();
    }
  }

  leaveCall() {
    if (this.groupId) emit('call:group-leave', { groupId: this.groupId }).catch(() => {});
    this._cleanupAll();
    this._resetIdle();
  }

  toggleMic() {
    if (!this.localStream) return;
    const track = this.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    this.micMuted = !track.enabled;
    this._notify();
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    this.peers.forEach((entry) => {
      if (entry.audioEl) entry.audioEl.muted = this.deafened;
    });
    this._notify();
  }

  async toggleScreenShare() {
    if (this.state !== 'connected') return;
    if (this.sharingLocal) {
      this._stopScreenShareLocal();
      for (const peerId of this.peers.keys()) await this._createAndSendOffer(peerId);
      emit('screenshare:group-state', { groupId: this.groupId, sharing: false }).catch(() => {});
      this._notify();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const audioTrack = stream.getAudioTracks()[0];
      this.localScreenStream = stream;
      this.sharingLocal = true;
      this.peers.forEach((entry, peerId) => {
        entry.screenSender = entry.pc.addTrack(track, stream);
        if (audioTrack) entry.screenAudioSender = entry.pc.addTrack(audioTrack, stream);
      });
      track.onended = () => {
        if (this.sharingLocal) this.toggleScreenShare();
      };
      for (const peerId of this.peers.keys()) await this._createAndSendOffer(peerId);
      emit('screenshare:group-state', { groupId: this.groupId, sharing: true }).catch(() => {});
      this._notify();
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela', 'err');
    }
  }

  _stopScreenShareLocal() {
    this.peers.forEach((entry) => {
      if (entry.screenSender) {
        try { entry.pc.removeTrack(entry.screenSender); } catch { /* already gone */ }
        entry.screenSender = null;
      }
      if (entry.screenAudioSender) {
        try { entry.pc.removeTrack(entry.screenAudioSender); } catch { /* already gone */ }
        entry.screenAudioSender = null;
      }
    });
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    this.sharingLocal = false;
  }

  participantList() {
    return [...this.peers.values()];
  }

  elapsedSeconds() {
    if (!this.connectedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - this.connectedAt) / 1000));
  }

  isLocalSpeaking() {
    return this._localSpeakingTracker ? this._localSpeakingTracker.isSpeaking() : false;
  }

  isPeerSpeaking(peerId) {
    const entry = this.peers.get(peerId);
    return entry && entry.speakingTracker ? entry.speakingTracker.isSpeaking() : false;
  }

  setPeerVolume(peerId, volume) {
    const entry = this.peers.get(peerId);
    if (entry && entry.audioEl) entry.audioEl.volume = clampVolume(volume);
  }

  // The screenshare <video> element is (re)created by the renderer on every
  // render, so there's no stored reference here — the renderer re-applies
  // the stored volume itself each time. This is only for a live slider drag
  // while that element is already mounted and showing this peer's share.
  setPeerShareVolume(volume) {
    const videoEl = document.getElementById('screenshare-video');
    if (videoEl) videoEl.volume = clampVolume(volume);
  }

  // ---- socket handlers ----

  _onIncoming({ group, from }) {
    if (this.state !== 'idle') return;
    this.state = 'ringing';
    this.group = group;
    this.groupId = group.id;
    this.ringingFrom = from;
    this._notify();
  }

  async _onParticipantJoined({ groupId, user }) {
    if (groupId !== this.groupId || this.state !== 'connected') return;
    const entry = this._ensurePeer(user);
    await this._addLocalTracks(entry);
    this._notify();
  }

  _onParticipantLeft({ groupId, userId }) {
    if (groupId !== this.groupId) return;
    const entry = this.peers.get(userId);
    if (entry) {
      this._teardownPeer(entry);
      this.peers.delete(userId);
    }
    this._orphanIceCandidates.delete(userId);
    this._notify();
  }

  async _onOffer({ groupId, from, sdp }) {
    if (groupId !== this.groupId) return;
    let entry = this.peers.get(from);
    if (!entry) {
      entry = this._ensurePeer({ id: from });
      await this._addLocalTracks(entry);
    }
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this._flushIceQueue(entry);
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    await emit('call:group-answer', { groupId: this.groupId, to: from, sdp: entry.pc.localDescription }).catch(() => {});
    this._notify();
  }

  async _onAnswer({ groupId, from, sdp }) {
    if (groupId !== this.groupId) return;
    const entry = this.peers.get(from);
    if (!entry) return;
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this._flushIceQueue(entry);
  }

  async _onIceCandidate({ groupId, from, candidate }) {
    if (groupId !== this.groupId || !candidate) return;
    const entry = this.peers.get(from);
    if (!entry) {
      // We don't know this peer yet — buffer it instead of dropping it;
      // _ensurePeer() drains this the moment the entry is created.
      if (!this._orphanIceCandidates.has(from)) this._orphanIceCandidates.set(from, []);
      this._orphanIceCandidates.get(from).push(candidate);
      return;
    }
    if (entry.pc.remoteDescription) {
      try { await entry.pc.addIceCandidate(candidate); } catch { /* ignore */ }
    } else {
      entry.iceQueue.push(candidate);
    }
  }

  _onRemoteScreenState({ groupId, userId, sharing }) {
    if (groupId !== this.groupId) return;
    const entry = this.peers.get(userId);
    if (!entry) return;
    entry.remoteSharing = !!sharing;
    if (!sharing) entry.remoteScreenStream = null;
    this._notify();
  }

  // ---- internals ----

  _ensurePeer(user) {
    let entry = this.peers.get(user.id);
    if (entry) {
      entry.user = { ...entry.user, ...user };
      return entry;
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    entry = { pc, user, iceQueue: [], remoteAudioStream: null, remoteScreenStream: null, remoteSharing: false, screenSender: null, screenAudioSender: null, audioEl: null, speakingTracker: null };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        emit('call:group-ice-candidate', { groupId: this.groupId, to: user.id, candidate: event.candidate }).catch(() => {});
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn(`[orbit] group call: conexão com ${user.username || user.id} ficou "${pc.iceConnectionState}" — provável bloqueio de NAT/firewall entre os dois.`);
      }
    };
    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        // Voice negotiates at call setup, well before screen share is even
        // possible to start — so the first audio track from a peer is
        // always their mic, and anything after that is their shared
        // screen's own sound, bundled into remoteScreenStream so it plays
        // through the same <video> element as the screen video.
        if (!entry.remoteAudioStream) {
          entry.remoteAudioStream = new MediaStream();
          entry.remoteAudioStream.addTrack(event.track);
          if (!entry.audioEl) {
            const audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            audioEl.muted = this.deafened;
            audioEl.volume = clampVolume(getStoredVolume(user.id));
            document.body.appendChild(audioEl);
            entry.audioEl = audioEl;
          }
          entry.audioEl.srcObject = entry.remoteAudioStream;
          entry.audioEl.play().catch(() => {});
          entry.speakingTracker = new SpeakingTracker(entry.remoteAudioStream);
        } else {
          if (!entry.remoteScreenStream) entry.remoteScreenStream = new MediaStream();
          entry.remoteScreenStream.addTrack(event.track);
        }
      } else if (event.track.kind === 'video') {
        if (!entry.remoteScreenStream) entry.remoteScreenStream = new MediaStream();
        entry.remoteScreenStream.addTrack(event.track);
        entry.remoteSharing = true;
        event.track.onended = () => {
          entry.remoteSharing = false;
          entry.remoteScreenStream = null;
          this._notify();
        };
        this._notify();
      }
    };
    this.peers.set(user.id, entry);

    const orphaned = this._orphanIceCandidates.get(user.id);
    if (orphaned) {
      entry.iceQueue.push(...orphaned);
      this._orphanIceCandidates.delete(user.id);
    }

    return entry;
  }

  async _addLocalTracks(entry) {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track) => entry.pc.addTrack(track, this.localStream));
    if (this.sharingLocal && this.localScreenStream) {
      entry.screenSender = entry.pc.addTrack(this.localScreenStream.getVideoTracks()[0], this.localScreenStream);
      const audioTrack = this.localScreenStream.getAudioTracks()[0];
      if (audioTrack) entry.screenAudioSender = entry.pc.addTrack(audioTrack, this.localScreenStream);
    }
  }

  async _ensureLocalAudio() {
    if (this.localStream) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micMuted = false;
    this._localSpeakingTracker = new SpeakingTracker(this.localStream);
  }

  async _createAndSendOffer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await emit('call:group-offer', { groupId: this.groupId, to: peerId, sdp: entry.pc.localDescription }).catch(() => {});
  }

  async _flushIceQueue(entry) {
    const queue = entry.iceQueue;
    entry.iceQueue = [];
    for (const candidate of queue) {
      try { await entry.pc.addIceCandidate(candidate); } catch { /* ignore */ }
    }
  }

  _teardownPeer(entry) {
    try { entry.pc.close(); } catch { /* ignore */ }
    if (entry.audioEl) {
      entry.audioEl.srcObject = null;
      entry.audioEl.remove();
    }
    if (entry.speakingTracker) entry.speakingTracker.stop();
  }

  _cleanupAll() {
    this.peers.forEach((entry) => this._teardownPeer(entry));
    this.peers.clear();
    this._orphanIceCandidates.clear();
    if (this._localSpeakingTracker) { this._localSpeakingTracker.stop(); this._localSpeakingTracker = null; }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    this.sharingLocal = false;
    this.micMuted = false;
    this.deafened = false;
  }

  _resetIdle() {
    this.state = 'idle';
    this.groupId = null;
    this.group = null;
    this.ringingFrom = null;
    this.connectedAt = null;
    this._notify();
  }
}

export const groupCallManager = new GroupCallManager();
