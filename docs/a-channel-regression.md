# A 通道回归矩阵使用说明

## 1. 目标

为 A 通道（`/ws/voice`）提供统一回归入口，覆盖 10 类核心生存场景，并输出结构化 JSON 结果，支持本地与 CI 自动执行。

## 2. 前置条件

- Node.js `>=22`
- pnpm `>=9`
- 已安装依赖：`pnpm install`
- 本地执行默认会自动拉起服务（`src/server.ts`）

链路场景（`s03`~`s07`）依赖以下环境变量，缺失时会自动 `skip`：

- ASR/TTS：`VOLC_APP_KEY`、`VOLC_ACCESS_KEY`、`VOLC_ASR_RESOURCE_ID`（或 `VOLC_RESOURCE_ID`）、`VOLC_TTS_RESOURCE_ID`（或 `VOLC_RESOURCE_ID`）
- LLM：`OPENAI_API_KEY`

## 3. 快速开始

```bash
pnpm run regression:a-channel
```

常用命令：

```bash
# 指定结果输出文件
pnpm run regression:a-channel -- --output artifacts/a-channel-local.json

# 只执行部分场景
pnpm run regression:a-channel -- --scenarios s01-lifecycle,s08-ping-pong

# 服务已在外部启动时，不自动拉起
pnpm run regression:a-channel -- --no-spawn-server

# 指定语音样本文件（推荐用于链路场景）
pnpm run regression:a-channel -- --audio-file src/audio/test.mp3

# 开启详细日志
pnpm run regression:a-channel -- --verbose
```

说明：

- 若存在 `src/audio/test.mp3`，脚本会默认将其作为语音夹具输入
- 若音频夹具不可用，会自动回退为内置纯音帧（仅适合基础链路，不适合验证 ASR 文本链路）

## 4. 场景矩阵（10 项）

- `s01-lifecycle`：连接与会话生命周期
- `s02-audio-before-start`：未 start 先 audio
- `s03-audio-to-asr`：音频上行到 ASR
- `s04-asr-final-to-assistant`：ASR final 到 assistant
- `s05-assistant-to-tts`：assistant 到 tts
- `s06-barge-in`：打断语义
- `s07-close-mic-recovery`：close_mic 恢复能力
- `s08-ping-pong`：保活链路
- `s09-invalid-message`：非法消息健壮性
- `s10-disconnect-cleanup`：断连清理能力

## 5. 结果判定与退出码

场景级：

- `pass`：断言全部通过
- `fail`：存在断言失败或执行异常
- `skip`：依赖不足或按条件跳过

运行级（`summary.status`）：

- `pass`：无场景失败，且门禁条件满足
- `warn`：仅用于 `gate-stage B` 且性能阈值未达标（软门禁）
- `fail`：存在场景失败，或处于硬门禁且性能阈值失败

CLI 退出码：

- `0`：`pass` / `warn`
- `1`：`fail`
- `2`：`--scenarios` 未匹配到任何场景

## 6. 性能指标与门禁阶段

指标：`speech_end -> first_audio`

阈值：

- `p50 <= 900ms`
- `p95 <= 1500ms`

阶段：

- `A`：仅观测，不作为失败条件
- `B`：软门禁（可告警，不阻塞）
- `C`：硬门禁（阈值失败即失败）

示例：

```bash
# Stage B 软门禁
pnpm run regression:a-channel -- --gate-stage B

# Stage C 硬门禁
pnpm run regression:a-channel -- --gate-stage C --enforce-thresholds
```

## 7. 输出结构

输出 JSON 关键字段：

- 运行元信息：`runId`、`startedAt`、`endedAt`、`durationMs`、`git`
- 执行选项：`options.url`、`options.selectedScenarios`、`options.gateStage`、`options.prerequisites`
- 阈值配置：`thresholds`
- 性能统计：`performance.sampleCount`、`performance.p50Ms`、`performance.p95Ms`、`performance.thresholdStatus`
- 汇总：`summary.total/passed/failed/skipped/status`
- 逐场景明细：`scenarios[].status/assertions/metrics/notes/events`

参考样例：`docs/samples/a-channel-regression.sample.json`

## 8. CI 使用

文件：`.github/workflows/a-channel-regression.yml`

- PR / 手动触发：`gate-stage A`，非阻塞，产物 `a-channel-regression-pr`
- Nightly（cron）：`gate-stage B`，软门禁，产物 `a-channel-regression-nightly`

若要切到 PR 硬门禁：

1. 将 PR 任务命令改为 `--gate-stage C --enforce-thresholds`
2. 取消该步骤 `continue-on-error: true`

## 9. 常见问题

- 结果里大量 `skip`：通常是未配置链路依赖环境变量，先检查 `options.prerequisites`
- `server not ready within ...`：服务未按预期启动，先本地手动跑 `pnpm dev` 验证
- `未匹配到任何场景`：检查 `--scenarios` 场景 ID 是否正确

## 10. 最小检验流程（建议）

```bash
# 1) 全量跑一遍
pnpm run regression:a-channel -- --output artifacts/a-channel-local.json

# 2) 仅跑基础可用性（无外部依赖）
pnpm run regression:a-channel -- --scenarios s01-lifecycle,s02-audio-before-start,s08-ping-pong,s09-invalid-message,s10-disconnect-cleanup

# 3) 查看 summary 与 failed 场景
cat artifacts/a-channel-local.json
```

## 11. 多轮结果汇总

```bash
# 连续执行 10 轮（遇到单轮失败也继续）
for i in {1..10}; do
  pnpm run regression:a-channel -- --audio-file src/audio/test.mp3 --output logs/regression/a-channel/run-$i.json || true
done

# 一键汇总 run-*.json
pnpm run regression:a-channel:summary
```

可选参数：

```bash
# 自定义输入目录、匹配规则、输出文件、阈值
pnpm run regression:a-channel:summary -- \
  --dir logs/regression/a-channel \
  --pattern '^run-\\d+\\.json$' \
  --output logs/regression/a-channel/summary.json \
  --p50-threshold 900 \
  --p95-threshold 1500
```
