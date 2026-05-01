import { appConfig } from '../../../packages/config/index.js';
import { CameraService } from '../../../services/camera/camera.service.js';
import { CalendarService } from '../../../services/calendar/calendar.service.js';
import { MediaService } from '../../../services/media/media.service.js';
import { AutomationService } from '../../../services/automation/automation.service.js';

export function createServiceRegistry() {
  return {
    camera: new CameraService({ pollIntervalMs: appConfig.pollIntervalMs }),
    calendar: new CalendarService(),
    media: new MediaService(),
    automation: new AutomationService()
  };
}
