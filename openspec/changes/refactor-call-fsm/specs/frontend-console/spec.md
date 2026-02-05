## MODIFIED Requirements
### Requirement: 日志展示
系统 SHALL 提供会话与事件日志展示能力。

#### Scenario: 日志输出（可收起/清空）
- **WHEN** 前端收到服务端消息或发送控制指令
- **THEN** 日志区域 SHALL 记录并展示消息内容，默认收起，可点击展开查看，并提供清空日志的操作

## ADDED Requirements
### Requirement: 对话分栏展示
系统 SHALL 在前端测试控制台展示整段对话内容，助手与用户分栏排列（助手左、用户右），按轮次追加。

#### Scenario: 轮次对话展示
- **WHEN** 收到一轮 ASR final 文本与对应助手回复
- **THEN** 前端 SHALL 将用户文本追加到右栏，将助手文本（流式累积）追加到左栏，形成完整对话记录
