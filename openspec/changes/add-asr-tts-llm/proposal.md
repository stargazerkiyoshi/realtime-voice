# 变更：集成火山云 ASR/TTS 与可配置 OpenAI 兼容 LLM

## 背景
为达成 MVP 的低延迟实时语音对话，需要接入正式的语音识别/合成与大模型服务，替换当前占位实现。

## 目标
- 接入火山引擎流式 ASR：支持 partial/final、置信度、时间戳，输入 16k 单声道 PCM WebSocket 音频。
- 接入火山引擎流式 TTS：支持可配置语音参数，低延迟输出音频 chunk。
- 接入 OpenAI 兼容 LLM：模型名、base URL、API key 可配置，支持流式 token。
- 将 VAD -> ASR -> LLM -> 文本分片 -> TTS -> 播放队列 串入会话 FSM，保留打断能力。

## 影响范围
- 新增能力：`asr-tts-llm` 规格
- 代码：会话内核、事件总线、编排/LLM/ASR/TTS 适配器、配置层。
