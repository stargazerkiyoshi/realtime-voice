## 1. 设计与规范
- [x] 1.1 补充/确认通话 FSM 状态与时序（LISTENING → THINKING → SPEAKING → LISTENING，含 TURN_ENDING/RESTARTING，如需）。
- [x] 1.2 定义“计划内关闭”协议：接口、事件、错误映射，适配 ASR/TTS/LLM。
- [x] 1.3 设定闲置/超时策略的默认值与配置项。

## 2. 实现
- [x] 2.1 引入轮次管理器：处理 speech_start/speech_end、turn id、turn PCM 归档，驱动 ASR 重启。
- [x] 2.2 在 Session 中实现计划关闭判断；将 ASR idle/正常关闭视为可恢复事件，触发安全重启而非 SESSION_ERROR。
- [x] 2.3 暂时注释/屏蔽打断（barge-in）逻辑，默认顺序对话；保留可选开关。
- [x] 2.4 为 ASR/TTS/LLM 适配器实现 planClose/isPlannedClose 等钩子，贯通到 Session。
- [x] 2.5 配置层新增闲置/超时参数（idle_ms、max_utter_ms、silence_to_hangup_ms 等），并在链路中使用。
- [x] 2.6 前端控制台：日志区域默认收起且可清空；新增助手/用户分栏的对话内容展示。

## 3. 验证
- [ ] 3.1 增加最小集成/烟雾测试（可脚本或手动步骤）覆盖：连续轮次、静默超时、ASR idle 重启、禁用打断路径。
- [ ] 3.2 更新变更说明/README（如有）并记录默认配置。
