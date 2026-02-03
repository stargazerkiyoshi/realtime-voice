import { ToolRegistry } from './registry';
import { builtins } from './builtins';

export class ToolExecutor {
  registry: ToolRegistry;

  constructor() {
    this.registry = new ToolRegistry();
    this.registry.register('hangup', builtins.hangup);
    this.registry.register('send_notification', builtins.send_notification);
  }

  async execute(name: string, args: Record<string, unknown>) {
    const handler = this.registry.get(name);
    if (!handler) return { ok: false, error: 'TOOL_NOT_FOUND' };
    return handler(args);
  }
}
