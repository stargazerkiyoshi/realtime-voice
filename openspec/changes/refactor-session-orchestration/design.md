## Context
当前会话内核将音频输入、ASR、LLM、TTS 与 FSM 事件全部堆叠在单一 eventLoop 内，导致时序耦合与调试困难。需要在不改变外部协议的前提下，降低内部复杂度。

## Goals / Non-Goals
- Goals:
  - 以最小协调器驱动三条独立管线
  - ASR 连接生命周期与轮次边界解耦
  - SPEAKING -> LISTENING 的完成条件可验证
  - 暂时移除轮次切分逻辑，避免时序抖动
- Non-Goals:
  - 不引入新协议或外部依赖
  - 不改变前端交互流程

## Decisions
- Decision: 拆分为 Input/VAD、ASR、LLM/TTS 三条管线，协调器仅维护 LISTENING/SPEAKING。
- Decision: 将 turn idle 与 ws idle 分离，避免 ASR 连接因静音而频繁重连。
- Decision: 暂时关闭 TurnManager，ASR 结果不再由后端主动切分轮次。
- Alternatives considered: 保持现有 eventLoop 结构，仅修补边界条件。原因是难以持续维护，复杂度随功能增加快速上升。

## Risks / Trade-offs
- 风险: 迁移阶段可能引入时序回归。
- 缓解: 增加最小化的行为测试和关键事件日志。

## Migration Plan
1. 增量抽出管线接口与实现。
2. 协调器替换现有 eventLoop 的核心分支。
3. 保持 WebSocket 消息协议不变，灰度验证。

## Open Questions
- 是否需要为多并发预留 SessionManager 或限流接口？
- 无轮次切分时，ASR final 触发来源是否仅依赖服务端/显式 stop？
