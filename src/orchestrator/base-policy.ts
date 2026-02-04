export interface OrchestratorAction {
  type: 'say' | 'tool' | 'end' | 'switch';
  payload: unknown;
}

export interface OrchestratorPolicy {
  plan(input: { sessionId: string; userText: string }): AsyncGenerator<OrchestratorAction>;
}
