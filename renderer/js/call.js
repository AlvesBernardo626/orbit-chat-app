import { emit, on } from './api.js';
import { toast } from './ui.js';
import { SpeakingTracker } from './audioLevel.js';
import { getStoredVolume } from './volume.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

class CallManager {
  constructor() {
    this.state = 'idle'; // idle | calling | ringing | connected
    this.peer = null;
    this.connectedAt = null;
    this.pc = null;
    this.localStream = null;
    this.micMuted = false;
    this.deafened = false;
    this.sharingLocal = false;
    this.localScreenStream = null;
    this.remoteSharing = false;
    this.remoteScreenStream = null;
    this._screenSender = null;
    this._remoteAudioStream = null;
    this._localSpeakingTracker = null;
    this._remoteSpeakingTracker = null;
    this._iceQueue = [];
    this._listeners = [];
    this._bindSocket();
  }

  onUpdate(fn) { this._listeners.push(fn); }
  _notify() { this._listeners.forEach((fn) => fn(this)); }

  _bindSocket() {
    on('call:incoming', (payload) => this._onIncoming(payload));
    on('call:cancelled', (payload) => this._onCancelled(payload));
    on('call:accepted', (payload) => this._onAccepted(payload));
    on('call:declined', (payload) => this._onDeclined(payload));
    on('call:offer', (payload) => this._onOffer(payload));
    on('call:answer', (payload) => this._onAnswer(payload));
    on('call:ice-candidate', (payload) => this._onIceCandidate(payload));
    on('call:end', (payload) => this._onRemoteEnd(payload));
    on('screenshare:state', (payload) => this._onRemoteScreenState(payload));
  }

  async startCall(peerUser) {
    if (this.state !== 'idle') return;
    this.state = 'calling';
    this.peer = peerUser;
    this._notify();
    try {
      await emit('call:invite', { to: peerUser.id });
    } catch (err) {
      toast(err.message === 'offline' ? `${peerUser.username} está offline` : 'Não foi possível iniciar a chamada', 'err');
      this._resetIdle();
    }
  }

  cancelOutgoing() {
    if (this.state !== 'calling' || !this.peer) return;
    emit('call:cancel', { to: this.peer.id }).catch(() => {});
    this._resetIdle();
  }

  async acceptIncoming() {
    if (this.state !== 'ringing' || !this.peer) return;
    const peerId = this.peer.id;
    this.state = 'connected';
    this.connectedAt = Date.now();
    this._notify();
    try {
      this._ensurePeerConnection();
      await this._ensureLocalAudio();
      await emit('call:accept', { to: peerId });
    } catch (err) {
      toast('Não foi possível entrar na chamada', 'err');
      this.endCall();
    }
  }

  declineIncoming() {
    if (this.state !== 'ringing' || !this.peer) return;
    emit('call:decline', { to: this.peer.id }).catch(() => {});
    this._resetIdle();
  }

  endCall() {
    if (this.peer) emit('call:end', { to: this.peer.id }).catch(() => {});
    this._cleanupLocal();
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
    const audioEl = document.getElementById('remote-audio');
    if (audioEl) audioEl.muted = this.deafened;
    this._notify();
  }

  async toggleScreenShare() {
    if (this.state !== 'connected') return;
    if (this.sharingLocal) {
      this._stopScreenShareLocal();
      await this._renegotiate();
      emit('screenshare:state', { to: this.peer.id, sharing: false }).catch(() => {});
      this._notify();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      this.localScreenStream = stream;
      this.sharingLocal = true;
      this._screenSender = this.pc.addTrack(track, stream);
      track.onended = () => {
        if (this.sharingLocal) this.toggleScreenShare();
      };
      await this._renegotiate();
      emit('screenshare:state', { to: this.peer.id, sharing: true }).catch(() => {});
      this._notify();
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela', 'err');
    }
  }

  _stopScreenShareLocal() {
    if (this._screenSender) {
      try { this.pc.removeTrack(this._screenSender); } catch { /* already removed */ }
      this._screenSender = null;
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    this.sharingLocal = false;
  }

  elapsedSeconds() {
    if (!this.connectedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - this.connectedAt) / 1000));
  }

  isLocalSpeaking() {
    return this._localSpeakingTracker ? this._localSpeakingTracker.isSpeaking() : false;
  }

  isRemoteSpeaking() {
    return this._remoteSpeakingTracker ? this._remoteSpeakingTracker.isSpeaking() : false;
  }

  setRemoteVolume(volume) {
    const audioEl = document.getElementById('remote-audio');
    if (audioEl) audioEl.volume = volume;
  }

  // ---- socket event handlers ----

  _onIncoming(fromUser) {
    if (this.state !== 'idle') {
      emit('call:decline', { to: fromUser.id }).catch(() => {});
      return;
    }
    this.state = 'ringing';
    this.peer = fromUser;
    this._notify();
  }

  _onCancelled({ from }) {
    if (this.state === 'ringing' && this.peer && this.peer.id === from) {
      toast('Chamada cancelada');
      this._resetIdle();
    }
  }

  async _onAccepted({ from }) {
    if (this.state !== 'calling' || !this.peer || this.peer.id !== from) return;
    this.state = 'connected';
    this.connectedAt = Date.now();
    this._notify();
    try {
      this._ensurePeerConnection();
      await this._ensureLocalAudio();
      await this._createAndSendOffer();
    } catch (err) {
      toast('Falha ao conectar a chamada', 'err');
      this.endCall();
    }
  }

  _onDeclined({ from }) {
    if (this.state === 'calling' && this.peer && this.peer.id === from) {
      toast(`${this.peer.username} recusou a chamada`);
      this._resetIdle();
    }
  }

  async _onOffer({ from, sdp }) {
    if (!this.peer || this.peer.id !== from) return;
    const firstTime = !this.pc;
    if (firstTime) {
      this._ensurePeerConnection();
      try {
        await this._ensureLocalAudio();
      } catch {
        this.endCall();
        return;
      }
    }
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this._flushIceQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await emit('call:answer', { to: from, sdp: this.pc.localDescription }).catch(() => {});
    if (this.state !== 'connected') {
      this.state = 'connected';
      this.connectedAt = Date.now();
    }
    this._notify();
  }

  async _onAnswer({ from, sdp }) {
    if (!this.pc || !this.peer || this.peer.id !== from) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this._flushIceQueue();
  }

  async _onIceCandidate({ from, candidate }) {
    if (!this.peer || this.peer.id !== from || !candidate) return;
    if (this.pc && this.pc.remoteDescription) {
      try { await this.pc.addIceCandidate(candidate); } catch { /* ignore */ }
    } else {
      this._iceQueue.push(candidate);
    }
  }

  _onRemoteEnd({ from }) {
    if (this.peer && this.peer.id === from) {
      toast('Chamada encerrada');
      this._cleanupLocal();
      this._resetIdle();
    }
  }

  _onRemoteScreenState({ from, sharing }) {
    if (!this.peer || this.peer.id !== from) return;
    this.remoteSharing = !!sharing;
    if (!sharing) this.remoteScreenStream = null;
    this._notify();
  }

  // ---- internals ----

  _ensurePeerConnection() {
    if (this.pc) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate && this.peer) {
        emit('call:ice-candidate', { to: this.peer.id, candidate: event.candidate }).catch(() => {});
      }
    };
    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        if (!this._remoteAudioStream) this._remoteAudioStream = new MediaStream();
        this._remoteAudioStream.addTrack(event.track);
        const audioEl = document.getElementById('remote-audio');
        if (audioEl) {
          audioEl.srcObject = this._remoteAudioStream;
          audioEl.muted = this.deafened;
          audioEl.volume = this.peer ? getStoredVolume(this.peer.id) : 1;
          audioEl.play().catch(() => {});
        }
        if (!this._remoteSpeakingTracker) this._remoteSpeakingTracker = new SpeakingTracker(this._remoteAudioStream);
      } else if (event.track.kind === 'video') {
        if (!this.remoteScreenStream) this.remoteScreenStream = new MediaStream();
        this.remoteScreenStream.addTrack(event.track);
        this.remoteSharing = true;
        event.track.onended = () => {
          this.remoteSharing = false;
          this.remoteScreenStream = null;
          this._notify();
        };
        this._notify();
      }
    };
    this.pc = pc;
    this._iceQueue = [];
  }

  async _ensureLocalAudio() {
    if (this.localStream) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.localStream = stream;
    stream.getAudioTracks().forEach((track) => this.pc.addTrack(track, stream));
    this.micMuted = false;
    this._localSpeakingTracker = new SpeakingTracker(stream);
  }

  async _createAndSendOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await emit('call:offer', { to: this.peer.id, sdp: this.pc.localDescription });
  }

  async _renegotiate() {
    if (!this.pc || !this.peer) return;
    await this._createAndSendOffer();
  }

  async _flushIceQueue() {
    const queue = this._iceQueue;
    this._iceQueue = [];
    for (const candidate of queue) {
      try { await this.pc.addIceCandidate(candidate); } catch { /* ignore */ }
    }
  }

  _cleanupLocal() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch { /* ignore */ }
      this.pc = null;
    }
    const audioEl = document.getElementById('remote-audio');
    if (audioEl) audioEl.srcObject = null;
    this._remoteAudioStream = null;
    if (this._localSpeakingTracker) { this._localSpeakingTracker.stop(); this._localSpeakingTracker = null; }
    if (this._remoteSpeakingTracker) { this._remoteSpeakingTracker.stop(); this._remoteSpeakingTracker = null; }
    this.remoteScreenStream = null;
    this.remoteSharing = false;
    this.sharingLocal = false;
    this._screenSender = null;
    this.micMuted = false;
    this.deafened = false;
    this._iceQueue = [];
  }

  _resetIdle() {
    this.state = 'idle';
    this.peer = null;
    this.connectedAt = null;
    this._notify();
  }
}

export const callManager = new CallManager();
