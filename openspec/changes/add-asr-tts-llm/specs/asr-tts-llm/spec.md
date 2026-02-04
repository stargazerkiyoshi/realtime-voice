## ADDED Requirements
### Requirement: Volcengine Streaming ASR
系统 SHALL 集成火山引擎实时 ASR，支持单声道 16k PCM WebSocket 流输入，并输出 partial/final 结果、置信度与时间戳。

#### Scenario: Partial results
- **WHEN** 会话从前端收到持续的 PCM 音频流
- **THEN** 系统 SHALL 以火山 ASR 流式返回 partial 结果并透传到事件总线供编排使用

#### Scenario: Final results
- **WHEN** 火山 ASR 判定语音结束
- **THEN** 系统 SHALL 输出 final 结果，包含文本、置信度、起止时间戳，并标记 utterance 完成

### Requirement: Volcengine Streaming TTS
系统 SHALL 集成火山引擎实时 TTS，接受 LLM 文本增量并生成可播放的流式音频块，语音、速度等参数可配置。

#### Scenario: Streamed playback
- **WHEN** LLM 输出文本分片
- **THEN** 系统 SHALL 调用火山 TTS 流式接口返回音频 chunk，并推入播放队列以低延迟输出

### Requirement: OpenAI-Compatible LLM
系统 SHALL 通过 OpenAI 兼容 SDK 访问可配置的基座模型（模型名、base URL、API key 可配置），支持流式 token 输出。

#### Scenario: Streaming tokens
- **WHEN** 编排器提交多轮对话消息
- **THEN** LLM 客户端 SHALL 以流式 token 形式返回回复内容，以供分片器切分并驱动 TTS

### Requirement: Pipeline Integration
系统 SHALL 将 VAD -> ASR -> LLM -> 文本分片 -> TTS -> 播放队列 串联入现有会话 FSM，并保持打断（barge-in）可用。

#### Scenario: End-to-end turn
- **WHEN** 用户开始说话并结束一轮语音
- **THEN** 系统 SHALL 经 ASR 产出文本 -> 触发 LLM 流式回复 -> 分片 -> TTS 流式音频 -> 播放输出，总链路满足实时性目标，并在用户再次开口时执行打断
