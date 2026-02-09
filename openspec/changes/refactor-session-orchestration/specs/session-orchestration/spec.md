## ADDED Requirements
### Requirement: Session Pipeline Separation
系统 SHALL 将会话处理拆分为独立的 Input/VAD、ASR、LLM/TTS 管线，并由一个最小协调器编排。

#### Scenario: 简化职责
- **WHEN** 一个新会话建立
- **THEN** 系统 SHALL 初始化三条独立管线，并由协调器驱动它们交互

### Requirement: ASR Lifecycle Independence
系统 SHALL 将 ASR 连接生命周期与轮次边界解耦，并使用独立的 turn idle 与 ws idle 超时。

#### Scenario: 静音期间连接保持
- **WHEN** 轮次结束进入静音期
- **THEN** 系统 SHALL 仅触发轮次结束逻辑，而不必立即关闭 ASR 连接

### Requirement: Deterministic Turn Completion
系统 SHALL 仅在 TTS 产出完成且播放队列排空后从 SPEAKING 切回 LISTENING。

#### Scenario: 正常完成
- **WHEN** LLM/TTS 流式输出完成且播放队列排空
- **THEN** 会话状态 SHALL 切回 LISTENING

### Requirement: Turnless Session Mode (Temporary)
系统 SHALL 在当前阶段禁用后端轮次切分，不基于 VAD/idle 主动触发 ASR_FINAL。

#### Scenario: 无轮次切分
- **WHEN** 用户在会话中持续讲话
- **THEN** 系统 SHALL 不主动切分轮次，仅依赖 ASR 服务端 final 或显式 stop/外部控制
