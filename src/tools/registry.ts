export interface ToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler) {
    this.tools.set(name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }
}
