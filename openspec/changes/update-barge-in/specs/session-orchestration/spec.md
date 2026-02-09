## ADDED Requirements
### Requirement: Barge-In Interrupts Active Output
系统 SHALL 在 SPEAKING 期间检测到用户开口时，立即中断当前 LLM/TTS 输出、清空播放队列，并切回 LISTENING。

#### Scenario: 打断触发
- **WHEN** SPEAKING 期间检测到 speech_start
- **THEN** 系统 SHALL 终止当前输出、清空播放队列并切回 LISTENING

### Requirement: Barge-In Notification
系统 SHALL 在打断发生时向客户端发送 `barge_in` 事件。

#### Scenario: 通知前端停播
- **WHEN** 打断触发
- **THEN** 系统 SHALL 发送 `barge_in` 事件

### Requirement: Interrupted Assistant History
系统 SHALL 将已输出的 assistant 片段写入 history，并标记为 interrupted。

#### Scenario: 打断后的上下文
- **WHEN** 打断发生且 assistant 已输出部分文本
- **THEN** history 中 SHALL 记录该片段并带 interrupted 标记

### Requirement: Barge-In ASR Continuity
系统 SHALL 在打断发生后允许 ASR 继续接收音频，避免 asrClosing 阻塞。

#### Scenario: 插话不丢帧
- **WHEN** 打断发生且用户持续说话
- **THEN** 系统 SHALL 保证插话音频被继续送入 ASR
