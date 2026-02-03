export enum State {
  READY = 'READY',
  LISTENING = 'LISTENING',
  THINKING = 'THINKING',
  SPEAKING = 'SPEAKING',
  TOOL_RUNNING = 'TOOL_RUNNING',
  ENDING = 'ENDING',
  ENDED = 'ENDED'
}

export class FSM {
  state: State = State.READY;
}
