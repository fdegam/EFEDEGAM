import { Euler, Vector3 } from "three";

/** First-person navigation without mouse capture or third-party services. */
export class RoomNavigation {
  constructor(camera, canvas, bounds, { onChange, onInput, onTap, onHover }) {
    Object.assign(this, {
      camera,
      canvas,
      bounds,
      onChange,
      onInput,
      onTap,
      onHover,
    });
    this.enabled = true;
    this.keys = new Set();
    this.pointers = new Map();
    this.gesture = null;
    this.lastPinch = 0;
    this.euler = new Euler(0, 0, 0, "YXZ");
    this.direction = new Vector3();
    this.forward = new Vector3();
    this.right = new Vector3();
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    canvas.addEventListener(
      "pointerdown",
      (event) => this.pointerDown(event),
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => this.pointerMove(event),
      options,
    );
    canvas.addEventListener(
      "pointerup",
      (event) => this.pointerUp(event),
      options,
    );
    canvas.addEventListener(
      "pointercancel",
      (event) => this.pointerUp(event, true),
      options,
    );
    canvas.addEventListener(
      "lostpointercapture",
      (event) => this.pointerUp(event, true),
      options,
    );
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        this.onInput();
        this.move(
          0,
          -Math.sign(event.deltaY) *
            Math.min(Math.abs(event.deltaY) * 0.003, 0.3),
        );
      },
      { ...options, passive: false },
    );
    const bindings = {
      KeyW: "forward",
      ArrowUp: "forward",
      KeyS: "backward",
      ArrowDown: "backward",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right",
    };
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          !this.enabled ||
          document.activeElement !== canvas ||
          !bindings[event.code] ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        this.onInput();
        this.keys.add(bindings[event.code]);
        this.onChange();
      },
      options,
    );
    window.addEventListener(
      "keyup",
      (event) => {
        this.keys.delete(bindings[event.code]);
      },
      options,
    );
    canvas.addEventListener("blur", () => this.clearInput(), options);
    window.addEventListener("blur", () => this.clearInput(), options);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.clearInput();
      },
      options,
    );
  }
  clearInput() {
    this.keys.clear();
    this.pointers.clear();
    this.gesture = null;
    this.lastPinch = 0;
    this.canvas.classList.remove("is-dragging");
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clearInput();
  }
  setDirection(direction, pressed) {
    if (!this.enabled) return;
    if (pressed) {
      this.onInput();
      this.keys.add(direction);
      this.onChange();
    } else this.keys.delete(direction);
  }
  pointerDown(event) {
    if (!this.enabled || event.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.euler.setFromQuaternion(this.camera.quaternion, "YXZ");
      this.gesture = {
        x: event.clientX,
        y: event.clientY,
        yaw: this.euler.y,
        pitch: this.euler.x,
        moved: false,
      };
    } else {
      if (this.gesture) this.gesture.moved = true;
      this.lastPinch = this.pinchDistance();
    }
  }
  pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  pointerMove(event) {
    if (!this.enabled) return;
    if (!this.pointers.has(event.pointerId)) {
      this.onHover(event.clientX, event.clientY);
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size > 1) {
      const distance = this.pinchDistance();
      this.onInput();
      this.move(0, (distance - this.lastPinch) * 0.008);
      this.lastPinch = distance;
      return;
    }
    if (!this.gesture) return;
    const dx = event.clientX - this.gesture.x,
      dy = event.clientY - this.gesture.y;
    if (!this.gesture.moved && Math.hypot(dx, dy) < 6) return;
    this.gesture.moved = true;
    this.onInput();
    this.canvas.classList.add("is-dragging");
    this.euler.set(
      Math.max(-0.75, Math.min(0.75, this.gesture.pitch - dy * 0.003)),
      this.gesture.yaw - dx * 0.003,
      0,
      "YXZ",
    );
    this.camera.quaternion.setFromEuler(this.euler);
    this.onChange();
  }
  pointerUp(event, cancelled = false) {
    if (!this.pointers.has(event.pointerId)) return;
    const tap =
      !cancelled &&
      this.pointers.size === 1 &&
      this.gesture &&
      !this.gesture.moved;
    this.pointers.delete(event.pointerId);
    if (!this.pointers.size) {
      this.gesture = null;
      this.lastPinch = 0;
      this.canvas.classList.remove("is-dragging");
      if (tap) this.onTap(event.clientX, event.clientY);
    } else {
      const [remaining] = this.pointers.values();
      this.euler.setFromQuaternion(this.camera.quaternion, "YXZ");
      this.gesture = {
        ...remaining,
        yaw: this.euler.y,
        pitch: this.euler.x,
        moved: true,
      };
    }
  }
  move(side, ahead) {
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    this.camera.position
      .addScaledVector(this.forward, ahead)
      .addScaledVector(this.right, side);
    this.camera.position.x = Math.max(
      this.bounds.minX,
      Math.min(this.bounds.maxX, this.camera.position.x),
    );
    this.camera.position.z = Math.max(
      this.bounds.minZ,
      Math.min(this.bounds.maxZ, this.camera.position.z),
    );
    this.onChange();
  }
  update(dt) {
    if (!this.enabled || !this.keys.size) return false;
    let side = Number(this.keys.has("right")) - Number(this.keys.has("left"));
    let ahead =
      Number(this.keys.has("forward")) - Number(this.keys.has("backward"));
    const length = Math.hypot(side, ahead) || 1;
    this.move((side / length) * dt * 1.25, (ahead / length) * dt * 1.25);
    return true;
  }
  dispose() {
    this.clearInput();
    this.abort.abort();
  }
}
