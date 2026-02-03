import type { ToolResult } from './registry';

export const builtins = {
  async hangup(args: Record<string, unknown>): Promise<ToolResult> {
    return { ok: true, result: { reason: args.reason ?? 'hangup' } };
  },
  async send_notification(args: Record<string, unknown>): Promise<ToolResult> {
    return { ok: true, result: { channel: args.channel, to: args.to } };
  }
};
