import { eventBus } from '../../core/event-bus.js';

export class AutomationService {
  trigger(ruleId, context = {}) {
    eventBus.emitEvent('automation.ruleTriggered', {
      ruleId,
      context
    }, 'automation-service');
  }
}
