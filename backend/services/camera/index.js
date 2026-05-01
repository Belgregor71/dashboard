import crypto from 'crypto';

export class CameraService {
  constructor({ pollIntervalMs = 5000, eventBus }) {
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
    this.eventBus = eventBus;
  }
  start() { if (!this.timer) this.timer = setInterval(() => this.poll(), this.pollIntervalMs); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async poll() {
    const cameraId = 'front-door';
    const timestamp = Date.now();
    this.eventBus.emit({ type: 'CAMERA_MOTION_DETECTED', timestamp, payload: { id: crypto.randomUUID(), cameraId, zone: 'default' } });
    this.eventBus.emit({ type: 'CAMERA_IMAGE_CAPTURED', timestamp, payload: { id: crypto.randomUUID(), cameraId, imageUrl: `/assets/cameras/${cameraId}/latest.webp` } });
  }
}
