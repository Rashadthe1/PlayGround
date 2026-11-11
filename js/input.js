// Unified keyboard / mouse / touch input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.dragging = false;
    this.last = { x: 0, y: 0 };
    this.touch = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.camTouch = { id: null, x: 0, y: 0 };
    this.actionQueue = new Set();
    this.enabled = true;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.dragging = true;
      this.last.x = e.clientX; this.last.y = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerType === 'touch') return;
      this.look.x += e.clientX - this.last.x;
      this.look.y += e.clientY - this.last.y;
      this.last.x = e.clientX; this.last.y = e.clientY;
    });
    el.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY) * 0.7; e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // touch: left half joystick, right half camera drag
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && this.touch.id === null) {
          this.touch = { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
          this.showJoystick?.(t.clientX, t.clientY);
        } else if (this.camTouch.id === null) {
          this.camTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.x = t.clientX; this.touch.y = t.clientY;
          this.moveJoystick?.(t.clientX, t.clientY);
        } else if (t.identifier === this.camTouch.id) {
          this.look.x += t.clientX - this.camTouch.x;
          this.look.y += t.clientY - this.camTouch.y;
          this.camTouch.x = t.clientX; this.camTouch.y = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) { this.touch.id = null; this.touch.active = false; this.hideJoystick?.(); }
        if (t.identifier === this.camTouch.id) this.camTouch.id = null;
      }
    };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
  }

  bindActions() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.actionQueue.add(btn.dataset.action);
      });
    });
  }

  get forward() { return (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ? 1 : (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ? -1 : 0; }
  get strafe() { return (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ? 1 : (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ? -1 : 0; }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  get jump() { return this.keys.has('Space'); }
  get jumpPressed() { return this.pressed.has('Space'); }

  axis() {
    let x = this.strafe, y = this.forward;
    if (this.touch.active) {
      const dx = this.touch.x - this.touch.ox, dy = this.touch.y - this.touch.oy;
      const max = 58;
      x = Math.max(-1, Math.min(1, dx / max));
      y = Math.max(-1, Math.min(1, -dy / max));
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  consume() {
    const p = new Set(this.pressed);
    this.pressed.clear();
    const actions = new Set(this.actionQueue);
    this.actionQueue.clear();
    return { pressed: p, actions };
  }

  resetLook() { this.look.x = 0; this.look.y = 0; }
}
