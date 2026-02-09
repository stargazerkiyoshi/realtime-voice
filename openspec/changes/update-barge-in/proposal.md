# Change: 更新打断（Barge-in）处理

## Why
- 当前打断仅在后端停止播放队列，前端未必停播，且 LLM/TTS 流式输出在打断后仍可能残留片段。
- 打断触发时存在 ASR 关闭窗口，可能丢掉用户插话的开头音频。
- 被打断的助手输出未形成一致的上下文记录，导致模型重复或误判。

## What Changes
- 规范打断流程：SPEAKING 期间检测到用户开口即中断 LLM/TTS、清空播放队列并切回 LISTENING，同时向客户端发送 `barge_in` 事件。
- 明确打断后的上下文策略：保存已输出的 assistant 片段并标记为 interrupted，供后续对话使用。
- 优化打断时的 ASR 状态切换，避免 asrClosing 阻塞打断后的首段语音。

## Impact
- Affected specs: session-orchestration, frontend-console
- Affected code: `src/core/session.ts`, `src/tts/playback.ts`, `frontend` 播放与 WS 处理逻辑
