## 1. Implementation
- [ ] 梳理并记录现有前端/后端音频链路（采集、降噪、VAD、ASR、LLM、TTS）。
- [ ] 在后端实现/确认“VAD 判语音段内才喂 ASR”的逻辑，并保留可配置阈值。
- [ ] 增加 silenceToHangupMs 静默挂断：TTS 完成后计时，无新 speech_start 则结束会话。
- [ ] 更新相关配置示例/文档（前端需降噪/AEC 优先，后端 VAD gating 说明）。
- [ ] 验证端到端：静音不触发 ASR、说话正常、静默后自动收口。
