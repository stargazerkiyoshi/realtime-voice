## ADDED Requirements
### Requirement: 打断事件停播
前端测试控制台 SHALL 在收到 `barge_in` 事件后立即停止播放并清空缓冲。

#### Scenario: 立刻停播
- **WHEN** 前端收到 `barge_in` 事件
- **THEN** 本地播放 SHALL 立即停止并清空缓冲队列
