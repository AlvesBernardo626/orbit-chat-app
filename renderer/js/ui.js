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

// Empty string (not a gradient fallback) so the caller's CSS class default
// banner gradient shows through untouched when there's no custom banner.
export function bannerStyle(user) {
  if (user && user.banner && user.banner.type === 'image' && user.banner.dataUrl) {
    return `background-image:url('${user.banner.dataUrl}'); background-size:cover; background-position:center;`;
  }
  return '';
}

export function formatJoinDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

// Splits on raw (unescaped) text so the URL regex never has to deal with
// HTML entities, then escapes each piece separately — link text/href and
// plain text both end up safely escaped either way.
export function linkifyHtml(text) {
  const raw = String(text ?? '');
  let result = '';
  let lastIndex = 0;
  for (const match of raw.matchAll(URL_PATTERN)) {
    const url = match[0];
    result += escapeHtml(raw.slice(lastIndex, match.index));
    const safeUrl = escapeHtml(url);
    result += `<a href="${safeUrl}" data-ext-link="1" rel="noopener">${safeUrl}</a>`;
    lastIndex = match.index + url.length;
  }
  result += escapeHtml(raw.slice(lastIndex));
  return result;
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
