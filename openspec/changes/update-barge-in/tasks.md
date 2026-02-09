## 1. Design
- [x] 1.1 明确打断触发点、状态切换与事件顺序
- [x] 1.2 定义被打断 assistant 的历史记录格式（含 interrupted 标记）

## 2. Implementation
- [x] 2.1 后端打断：中止 LLM/TTS 输出、清空播放队列、发送 `barge_in` 事件并切回 LISTENING
- [x] 2.2 后端打断后的 ASR：取消/绕过 asrClosing，确保插话音频可被采集
- [x] 2.3 前端处理 `barge_in`：停止本地播放并清空缓冲
- [ ] 2.4 日志与最小化验证：打断场景下无残音、无丢帧、上下文一致
