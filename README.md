# Realtime Voice（Node.js 版）

统一会话内核的实时语音系统，当前实现为 Node.js + Fastify + TypeScript。

## 功能概览
- 统一会话内核（事件总线 + 状态机）
- 流式链路占位实现：VAD -> ASR -> LLM -> TTS
- 支持打断（barge-in）
- WebSocket 入口（A 通道）
- 工具框架占位（`hangup`/`send_notification`）
- 前端测试台（Vite + React + Ant Design）

## 目录结构
```
src/
  adapters/            # 通道适配层（WebSocket 等）
  audio/               # VAD/ASR 等音频链路
  core/                # 会话内核（FSM、EventBus 等）
  llm/                 # LLM 占位实现与分片器
  observability/       # 观测占位（logger/metrics/tracing）
  orchestrator/        # 编排策略占位（flow/agent）
  tools/               # 工具框架与内置工具
  tts/                 # TTS 占位与播放队列
  server.ts            # Fastify 入口
frontend/              # 前端测试台（Vite + React + AntD）
legacy/python/         # 旧 Python 实现（已归档）
```

## 运行方式
```
npm install
npm run dev
```
默认监听：`0.0.0.0:3000`

## 启动脚本与示例
- 示例环境文件：`.env.example`
- 示例启动脚本（可提交）：`scripts/start.example.ps1`
- 本地启动脚本（不会提交）：`scripts/start.local.ps1`

建议流程：
1. 复制示例脚本：`Copy-Item scripts/start.example.ps1 scripts/start.local.ps1`
2. 编辑 `scripts/start.local.ps1`，填入你自己的密钥
3. 启动：`pnpm run dev:local`

如果只想看示例配置，可直接运行：`pnpm run dev:example`

## 测试
```
pnpm test
```

## 前端运行方式
```
cd frontend
pnpm install
pnpm dev
```
默认地址：`http://localhost:5173`

## WebSocket 协议（当前占位）
- 客户端发送：
  - `{"type":"start","session_id":"..."}`
  - `{"type":"audio","payload_b64":"...","ts_ms":123}`
  - `{"type":"stop","reason":"..."}`
  - `{"type":"ping"}`
- 服务端可能返回：
  - `ready` / `asr` / `assistant` / `tts` / `vad` / `barge_in` / `end`

## 开发说明
- 目前 ASR/LLM/TTS 均为占位实现，便于跑通链路与打断语义。
- 真正接入时，可替换 `src/audio`、`src/llm`、`src/tts` 模块。
- 会话逻辑集中在 `src/core/session.ts`。

## 计划与变更
- 迁移提案见：`openspec/changes/refactor-runtime-to-nodejs/`
- 项目上下文见：`openspec/project.md`
