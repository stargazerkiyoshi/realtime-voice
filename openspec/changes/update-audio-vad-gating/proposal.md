# Change: Update Audio VAD Gating and Silence Handling

## Why
- 现状前端全量推送音频，后端虽然加入“先 VAD 再喂 ASR”，但整体策略未成文，仍存在噪声/静默流占用 ASR、会话长期不收口的问题。
- 需要明确并落地端到端链路：采集、降噪、VAD 判段、ASR 送帧、LLM 触发时机、静默挂断，减少无效流量并降低延迟。

## What Changes
- 定义并实施“VAD 先行、段内送 ASR、段外丢弃/缓存”管线，允许前端/后端降噪前置。
- 增加静默自动挂断策略（silenceToHangupMs），在 TTS 结束后无新语音则结束会话。
- 明确 LLM 触发时机：保持“ASR FINAL 后再喂 LLM”的默认；预留选项描述（PARTIAL 流式）但不立即启用。

## Impact
- 代码：`src/core/session.ts`, 可能影响 VAD/ASR 配置与挂断逻辑；前端文档/接口说明。
- 行为：减少噪声触发的 ASR 调用和长时间空闲占用；用户体验更快收口、费用可控。
