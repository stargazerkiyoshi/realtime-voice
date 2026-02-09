## Context
当前打断逻辑集中在后端，且没有向前端声明“立刻停播”的强制指令；同时 ASR 关闭窗口与流式残片会导致体验不一致。

## Goals / Non-Goals
- Goals:
  - 打断时端到端“立刻静音”
  - 打断后无残片输出（文本与音频）
  - 打断后上下文可追溯（已输出内容有标记）
  - 插话音频不被 asrClosing 吞掉
- Non-Goals:
  - 不引入新的 ASR/LLM/TTS 服务
  - 不改变现有 WebSocket 消息协议的主要结构（仅使用已有 `barge_in` 事件）

## Decisions
- Decision: 服务器在检测到 `speech_start` 且处于 SPEAKING 时立即中断 LLM/TTS，清空播放队列，并发送 `barge_in` 事件。
- Decision: 前端收到 `barge_in` 后必须停止播放并清空缓冲，避免已下发音频继续播放。
- Decision: 被打断的 assistant 输出在 history 中记录为 partial，并带 `interrupted` 标记。
- Decision: 打断发生时取消或绕过 `asrClosing`，保证插话音频能被 ASR 继续接收。

## Risks / Trade-offs
- 风险: TTS 回声触发误打断。
- 缓解: 允许在配置中仅使用前端 VAD 或提高后端 VAD 门槛（由现有 VAD 配置控制）。

## Migration Plan
1. 后端补齐打断的流式中止与历史记录。
2. 前端实现 `barge_in` 停播。
3. 验证打断前后延迟与上下文一致性。

## Open Questions
- 是否需要在客户端暴露“打断来源”以便区分误触发与真实插话？
