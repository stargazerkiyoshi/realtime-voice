import type { OrchestratorAction, OrchestratorPolicy } from './base_policy';

export class AgentPolicy implements OrchestratorPolicy {
  async *plan(_input: { sessionId: string; userText: string }): AsyncGenerator<OrchestratorAction> {
    yield { type: 'say', payload: '（Agent占位）' };
  }
}
