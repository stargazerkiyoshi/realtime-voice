# Realtime Voice（Node.js 版）

统一会话内核的实时语音系统，当前实现为 Node.js + Fastify + TypeScript。

## 功能概览
- 统一会话内核（事件总线 + 状态机）
- 流式链路：VAD -> ASR(Volc v3) -> LLM(OpenAI) -> TTS(Volc v3)
- 支持打断（barge-in）
- WebSocket 入口（A 通道）
- 工具框架占位（`hangup`/`send_notification`）
- 前端测试台（Vite + React + Ant Design，支持麦克风采集与TTS播放）

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

## 关键环境变量
- `VOLC_APP_KEY` / `VOLC_ACCESS_KEY`：火山鉴权
- `VOLC_ASR_RESOURCE_ID`：ASR 资源ID
- `VOLC_TTS_RESOURCE_ID`：TTS 资源ID（注意不是模型名，不能填 `seed-tts-1.1`）
- `VOLC_TTS_MODEL`：TTS 模型参数（可填 `seed-tts-1.1`）
- `VOLC_VOICE_TYPE`：音色
- `OPENAI_API_KEY`：LLM 鉴权

## 日志
- 默认开启控制台日志与本地文件日志
- 本地日志默认路径：`logs/voice.log`（已在 `.gitignore`）
- 可选开关：
  - `DEBUG_VOICE=0`：关闭控制台调试日志
  - `LOG_TO_FILE=0`：关闭文件日志
  - `LOG_FILE=...`：自定义日志文件路径

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

## 前端测试流程
1. 打开 `http://localhost:5173/voice`
2. 点击 `Connect`
3. 点击 `Start Session`
4. 点击 `Start Mic` 讲话
5. 查看 ASR 文本、Assistant 文本和 TTS 播放

## WebSocket 协议（当前占位）
- 客户端发送：
  - `{"type":"start","session_id":"..."}`
  - `{"type":"audio","payload_b64":"...","ts_ms":123}`
  - `{"type":"stop","reason":"..."}`
  - `{"type":"ping"}`
- 服务端可能返回：
  - `ready` / `asr` / `assistant` / `tts` / `vad` / `barge_in` / `end`

## 故障排查
- TTS `Unexpected server response: 400`：
  - 检查 `VOLC_TTS_RESOURCE_ID` 是否为资源ID（如 `seed-tts-1.0`），不是模型名
- ASR `autoAssignedSequence mismatch`：
  - 升级到当前代码后已修复
- ASR `Timeout waiting next packet`：
  - 当前实现在 `speech_end` 后会主动结束本轮ASR并准备下一轮

## 计划与变更
- 迁移提案见：`openspec/changes/refactor-runtime-to-nodejs/`
- 项目上下文见：`openspec/project.md`
