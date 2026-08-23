export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(username) {
  const parts = String(username || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarStyle(user) {
  if (user && user.avatar && user.avatar.type === 'image' && user.avatar.dataUrl) {
    return `background-image:url('${user.avatar.dataUrl}');`;
  }
  const colors = (user && user.avatar && user.avatar.color) || ['#7b6ef6', '#4c3fc9'];
  return `background:linear-gradient(135deg, ${colors[0]}, ${colors[1]});`;
}

export function avatarHtml(user, sizeClass) {
  const showInitials = !(user && user.avatar && user.avatar.type === 'image' && user.avatar.dataUrl);
  return `<div class="avatar ${sizeClass}" style="${avatarStyle(user)}">${showInitials ? escapeHtml(initials(user ? user.username : '')) : ''}</div>`;
}

export function statusLabel(status) {
  switch (status) {
    case 'online': return 'Online';
    case 'away': return 'Ausente';
    case 'dnd': return 'Não perturbe';
    default: return 'Offline';
  }
}

export function statusDotClass(status) {
  switch (status) {
    case 'online': return 'status-online';
    case 'away': return 'status-away';
    case 'dnd': return 'status-dnd';
    default: return 'status-offline';
  }
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDayTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(ts);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function toast(message, kind = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s';
    setTimeout(() => el.remove(), 260);
  }, 3600);
}

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
