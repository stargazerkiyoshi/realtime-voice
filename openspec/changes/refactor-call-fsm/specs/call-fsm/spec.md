## ADDED Requirements
### Requirement: Turn Lifecycle & FSM 稳定
系统 SHALL 以显式轮次驱动通话状态机：speech_start → speech_end → 生成/播放回复 → 回到监听；闲置或超时只结束本轮，不终止 session。

#### Scenario: 正常轮次
- **WHEN** VAD 检测到 speech_start 并随后检测到 speech_end
- **THEN** 系统 SHALL 结束当前 ASR 轮次、提交文本给 LLM/TTS、完成播放后回到 LISTENING 状态，session 保持存活

#### Scenario: 闲置结束
- **WHEN** speech_end 后持续静默达到 idle_ms
- **THEN** 系统 SHALL 仅结束当前轮次并重启 ASR，session 不触发 SESSION_ERROR

### Requirement: 计划内关闭语义
系统 SHALL 支持 ASR/TTS/LLM 发出计划内关闭信号（如 idle/正常结束/调用方 close），会话层必须据此区分错误与正常结束。

#### Scenario: ASR 闲置关闭
- **WHEN** ASR 由于 idle 发送尾包并关闭
- **THEN** 会话层 SHALL 将其视为计划内事件，重启 ASR 供下一轮使用，不向客户端发送 error/end

### Requirement: 闲置与超时策略
系统 SHALL 暴露可配置的 idle_ms、max_utter_ms、silence_to_hangup_ms，并在达到阈值时执行预定义动作（结束轮次、提示或挂断）。

#### Scenario: 超长发言截断
- **WHEN** 单次讲话时长超过 max_utter_ms
- **THEN** 系统 SHALL 结束该轮 ASR 输入，返回当前识别结果并继续对话，避免长时间占用通道

### Requirement: 顺序对话（默认禁用打断）
系统 SHALL 默认运行非打断、顺序对话模式；打断路径被注释/关闭，仅保留配置开关以便后续恢复。

#### Scenario: 回复期间再次说话
- **WHEN** 用户在 TTS 播放期间说话
- **THEN** 系统 SHALL 忽略打断行为，不中断当前回复，待播放完成后进入下一轮 LISTENING
