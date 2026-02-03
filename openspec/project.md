# 项目上下文

## 目的
实时语音对话系统，采用统一的会话内核，同时支持三类入口：
- A：Web/App 实时语音（WebSocket）
- B：电话/VoIP 呼入（VoIP/SIP）
- C：电话/VoIP 外呼（VoIP/SIP）

核心目标是低延迟流式链路（ASR -> LLM -> TTS）、打断（barge-in）、基于 VAD 的轮次检测，以及可插拔的编排层，兼容强流程对话与 Agent/RAG 工具模式。

## 技术栈
- Node.js（TypeScript）
- Fastify WebSocket 服务（`src/server.ts`）
- tsx（本地开发运行）
- TypeScript 编译产物（`dist/`）
- 前端：Vite + React + Ant Design
- 路由：React Router
- 全局状态：Zustand

## 项目约定

### 代码风格
- 以异步优先，明确使用 `async`/`await`。
- `src/` 下按领域拆分小模块。
- 公共接口与数据结构使用类型标注。
- WebSocket I/O 使用 JSON 消息；输出时不转义非 ASCII。

### 架构模式
- **会话内核**：每个会话一个事件驱动状态机。
- **事件总线**：内部事件通过异步队列传递（`EventBus`）。
- **FSM**：轻量状态容器（`State`、`FSM`），包含 LISTENING/THINKING/SPEAKING 等状态。
- **打断控制**：在 TTS 期间检测到用户语音时取消 LLM/TTS 任务并清空播放队列。
- **适配器**：入口/出口按通道适配，映射到统一音频流接口。
- **流水线阶段**：VAD -> ASR（占位）-> LLM 流 -> 分片器 -> TTS 流 -> 播放队列。
- **可插拔编排器（规划中）**：强流程策略 vs Agent/RAG 策略。

### 测试策略
尚未定义。仓库目前无测试。建议在行为稳定后补齐（会话状态机转换、事件处理、打断、分片器）。

### Git 流程
未文档化。暂按主干分支简单流程处理，待补充规范。

## 领域上下文
- 一个 session 表示一次完整对话（网页一次进入或一次通话）。
- 端到端流式：ASR partial/final、LLM token 流式输出、TTS 流式输出。
- 打断是一级需求：用户开口应立即中断 TTS。
- 工具调用需遵循严格协议，且结果必须写入 history。
- 预期支持两种编排模式：
  - 强流程对话（状态机 + 槽位）
  - Agent/RAG（检索 + 工具调用）

## 重要约束
- 端到端延迟目标：<= 1.5s（speech_end -> 用户听到第一段回复）。
- 并发目标：初期 10 会话，支持水平扩展。
- MVP 优先级：打断、流式、VAD、最小工具调用（`hangup`、`send_notification`）。
- 隐私/合规与长期记忆明确不在 MVP 范围内。

## 外部依赖
当前运行时依赖：
- `fastify`
- `@fastify/websocket`
- `typescript`
- `tsx`
- `react`
- `react-dom`
- `react-router-dom`
- `zustand`
- `antd`

规划中的集成（尚未实现）：
- ASR 服务
- LLM 服务（流式）
- TTS 服务（流式）
- 呼入/外呼的 Telephony/SIP 媒体网关
