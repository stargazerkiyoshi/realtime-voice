## 1. Implementation
- [ ] 配置支持：在 `config.ts` 增加前端/后端 VAD 开关及默认值（后端 VAD 开启，前端 VAD 可选）。
- [ ] Session 读取配置：`session.ts` 根据配置决定是否在 LISTENING 阶段对上行音频做 VAD gating；若关闭则直送 ASR。
- [ ] 文档更新：前端采集建议（AEC/NS/AGC 约束、AudioWorklet、采样率）、双 VAD 配置矩阵、默认推荐值。
- [ ] 验证：前端无 VAD 时噪声不过多触发；前端 VAD 开时流量下降且识别正常。

## 2. (可选后续) 实验支持
- [ ] 增加运行时日志展示当前 VAD 组合（前/后端开关），便于实验对比。
