export class ServiceManager {
  constructor(serviceDefinitions = []) {
    this.serviceDefinitions = serviceDefinitions;
  }

  startAll() {
    for (const def of this.serviceDefinitions) {
      this.startOne(def);
    }
  }

  startOne(def) {
    try {
      def.instance.start?.();
    } catch (error) {
      setTimeout(() => this.startOne(def), def.restartDelayMs ?? 3000);
    }
  }

  stopAll() {
    for (const def of this.serviceDefinitions) {
      def.instance.stop?.();
    }
  }
}
