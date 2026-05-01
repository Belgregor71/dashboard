import { eventBus } from '../../packages/event-bus/index.js';

export class AutomationService {
  trigger(ruleId, context = {}) {
    eventBus.emitEvent('automation.ruleTriggered', {
      ruleId,
      context,
      timestamp: new Date().toISOString()
    });
  }
}
