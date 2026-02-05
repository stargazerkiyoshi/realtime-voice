# Change: Require Frontend AEC/NS and Configurable Dual VAD Gating

## Why
- 目前前端裸流上送，后端虽做 VAD gating，但噪声/回声仍可能触发 ASR；需要把降噪/AEC 前移到用户端。
- 希望同时保留前/后端 VAD，便于按场景切换和实验效果，避免强耦合。
- 需要在文档/配置层明确：何时把音频送 ASR、LLM 触发点，以及保持现有采样率与 AudioWorklet 方案。

## What Changes
- 前端要求：启用 AEC/NS/AGC（WebRTC 约束）；建议 AudioWorklet 方案、维持现行采样率/通道数；提供可选前端 VAD（可关）。
- 后端：保留 VAD 先行再喂 ASR的模式，增加开关以便对比实验（后端 VAD 开/关；前端 VAD 期待/忽略）。
- 触发策略：仍以 ASR FINAL 触发 LLM；不引入静默挂断（后续由上层流程控制）。
- 文档：补充前端采集配置、双 VAD 配置矩阵及推荐默认值。

## Impact
- 代码：`src/config.ts`（新增 VAD 相关开关）、`src/core/session.ts`（读取配置以决定是否 gating）。
- 文档：前端采集与后端配置说明；现有链路描述补充。
- 行为：默认更抗噪；可通过配置关闭后端 VAD 观察效果；保持现行采样率与 AudioWorklet。
