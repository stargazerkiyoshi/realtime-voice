# Change: Refactor Session Orchestration

## Why
当前会话内核把输入、ASR、LLM、TTS、状态机混在一个事件循环里，逻辑复杂且容易出现时序问题。需要把流程拆成更简单、职责清晰的管线，以提高稳定性并为后续多并发扩展留出空间。

## What Changes
- 拆分会话处理为三条独立管线（Input/VAD、ASR、LLM/TTS）和一个薄协调器。
- ASR 连接生命周期与轮次边界解耦，引入独立的 turn idle 和 ws idle 时序。
- 明确 SPEAKING -> LISTENING 的完成条件（TTS 产出完成 + 播放队列排空，或被打断）。
- 暂时移除轮次管理（TurnManager），不再基于 VAD/idle 主动切分轮次。
- 保持 WebSocket 协议与消息格式不变。

## Impact
- Affected specs: session-orchestration (new)
- Affected code: src/core/session.ts, src/core/event-bus.ts, src/asr/*, src/tts/*, src/llm/*
