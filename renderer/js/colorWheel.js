// Self-contained HSV color wheel: hue/saturation picked from the circle,
// value (brightness) controlled separately since a 2D wheel can only ever
// encode two of the three HSV axes.
export class ColorWheel {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.radius = this.size / 2;
    this.hue = 250;
    this.sat = 55;
    this.value = 100;
    this.onChange = onChange || (() => {});
    this._draw();
    this._wireEvents();
  }

  setFromHex(hex) {
    const { h, s, v } = hexToHsv(hex);
    this.hue = h;
    this.sat = s;
    this.value = v;
    this._draw();
  }

  setValue(v) {
    this.value = v;
    this._draw();
  }

  hex() {
    return hsvToHex(this.hue, this.sat, this.value);
  }

  _wireEvents() {
    let dragging = false;
    const pick = (evt) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left - this.radius;
      const y = evt.clientY - rect.top - this.radius;
      const dist = Math.min(this.radius, Math.hypot(x, y));
      let angle = (Math.atan2(y, x) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      this.hue = angle;
      this.sat = Math.round((dist / this.radius) * 100);
      this._draw();
      this.onChange(this.hex(), false);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      pick(e);
    });
    window.addEventListener('pointermove', (e) => {
      if (dragging) pick(e);
    });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      this.onChange(this.hex(), true);
    });
  }

  _draw() {
    const { ctx, size, radius } = this;
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius + 0.5;
        const dy = y - radius + 0.5;
        const dist = Math.hypot(dx, dy);
        const idx = (y * size + x) * 4;
        if (dist > radius) continue;
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        const sat = Math.min(100, (dist / radius) * 100);
        const [r, g, b] = hsvToRgb(angle, sat, this.value);
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const rad = (this.hue * Math.PI) / 180;
    const dist = (this.sat / 100) * radius;
    const mx = radius + Math.cos(rad) * dist;
    const my = radius + Math.sin(rad) * dist;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 7.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function hsvToRgb(h, s, v) {
  s /= 100;
  v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r;
  let g;
  let b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export function hsvToHex(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function hexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { h: 250, s: 55, v: 100 };
  const num = parseInt(m[1], 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d) % 6);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v };
}
