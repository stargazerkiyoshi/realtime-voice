# Realtime Voice（Node.js 版）

统一会话内核的实时语音系统，当前实现为 Node.js + Fastify + TypeScript。

## 功能概览
- 统一会话内核（事件总线 + 状态机）
- 流式链路：VAD -> ASR(Volc v3) -> LLM(OpenAI) -> TTS(Volc v3)
- 支持打断（barge-in）
- WebSocket 入口（A 通道）
- 工具框架占位（`hangup`/`send_notification`）
- 前端测试台（Vite + React + Ant Design，支持麦克风采集与TTS播放）

## 前端采集与音频建议
- 采集：`getUserMedia` 开启 `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`, `channelCount: 1`，采样率与服务端保持 24k（默认）或 16k 一致。
- 音频处理：推荐用 AudioWorklet 做重采样/增益/可选前端 VAD；示例骨架：

  ```ts
  // main thread
  await audioContext.audioWorklet.addModule('worklets/mic-processor.js');
  const source = audioContext.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audioContext, 'mic-processor', { numberOfInputs: 1, numberOfOutputs: 1 });
  source.connect(node).connect(audioContext.destination); // destination 仅为 keep-alive，可替换为自定义处理
  node.port.onmessage = ({ data }) => {
    if (data.type === 'pcm') ws.send(/* pcm16 buffer */);
    if (data.type === 'vad') {/* 前端 VAD 结果可用于暂停推流 */}
  };
  ```

  ```js
  // worklets/mic-processor.js
  class MicProcessor extends AudioWorkletProcessor {
    process(inputs) {
      const pcm = inputs[0][0];
      // TODO: 下行重采样/量化为 Int16，必要时做前端 VAD，静音时不 postMessage
      this.port.postMessage({ type: 'pcm', pcm });
      return true;
    }
  }
  registerProcessor('mic-processor', MicProcessor);
  ```

- 双 VAD 配置矩阵（通过环境变量控制）：

  | 组合 | 前端 VAD | 后端 VAD (`ENABLE_BACKEND_VAD`) | 适用场景 |
  | --- | --- | --- | --- |
  | 默认 | 关闭/无 | 开启 | 简单集成，后端负责 gating，容忍轻噪声 |
  | 前端+后端 | 开启 | 开启 | 双重保护，低带宽/噪声环境，前端静音时暂停推流 |
  | 仅前端 | 开启 | 关闭 | 做实验对比 ASR/费用；后端直通 ASR |

- 回声消除/降噪请尽量在前端完成（有扬声器参考信号，效果最佳）；后端不做 AEC，仅做 VAD gating。

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
- `VOLC_ASR_IDLE_MS`：轮次静音判定（毫秒），决定从“说完”到触发最终识别的延迟
- `VOLC_ASR_WS_IDLE_MS`：ASR 连接空闲关闭（毫秒），VAD 关闭或静音时避免频繁重连
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
