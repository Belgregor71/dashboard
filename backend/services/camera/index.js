import crypto from 'crypto';
import { eventBus } from '../../core/event-bus.js';

export class CameraService {
  constructor({ pollIntervalMs = 5000 } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    const cameraId = 'front-door';
    const timestamp = new Date().toISOString();

    eventBus.emitEvent('camera.motionDetected', {
      id: crypto.randomUUID(),
      cameraId,
      timestamp,
      zone: 'default'
    }, 'camera-service');

    eventBus.emitEvent('camera.imageCaptured', {
      id: crypto.randomUUID(),
      cameraId,
      timestamp,
      imageUrl: `/public/cameras/${cameraId}/latest.jpg`
    }, 'camera-service');
  }
}
