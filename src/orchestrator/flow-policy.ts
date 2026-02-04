import type { OrchestratorAction, OrchestratorPolicy } from './base-policy';

export class FlowPolicy implements OrchestratorPolicy {
  async *plan(_input: { sessionId: string; userText: string }): AsyncGenerator<OrchestratorAction> {
    yield { type: 'say', payload: '（流程占位）' };
  }
}
