import crypto from 'crypto';
import { eventBus } from '../../packages/event-bus/index.js';
import { throttle } from '../../packages/utils/throttle.js';

/**
 * Camera service is self-contained and only emits events.
 * It never mutates frontend/UI state directly.
 */
export class CameraService {
  constructor({ pollIntervalMs = 5000 } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
    this.emitMotionThrottled = throttle((payload) => {
      eventBus.emitEvent('camera.motionDetected', payload);
    }, 1000);
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
    // Placeholder for go2rtc/HA integration; keep CPU cost low.
    const cameraId = 'front-door';
    const timestamp = new Date().toISOString();
    const motionEvent = {
      id: crypto.randomUUID(),
      cameraId,
      timestamp,
      zone: 'default'
    };

    this.emitMotionThrottled(motionEvent);

    const imageCaptured = {
      id: crypto.randomUUID(),
      cameraId,
      timestamp,
      imageUrl: `/public/cameras/${cameraId}/latest.jpg`
    };
    eventBus.emitEvent('camera.imageCaptured', imageCaptured);
  }
}
