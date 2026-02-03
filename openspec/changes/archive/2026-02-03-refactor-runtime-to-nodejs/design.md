## 背景
当前实现为 Python（FastAPI + asyncio）。目标是完整迁移到 Node.js（Fastify + TypeScript），覆盖所有模块（适配器、会话内核、音频链路、编排、工具、观测）。

## 目标 / 非目标
- 目标：全量迁移到 Node.js（Fastify + TypeScript）；保持现有行为与协议；模块化结构不变。
- 非目标：引入新功能；在迁移阶段进行深度性能优化。

## 决策
- 决策：使用 Fastify 作为 Web/WebSocket 框架，全部运行时代码用 TypeScript。
- 备选方案：Express；Python/Node 混合。为保证单一运行时与工具链一致性，未采用。

## 风险 / 取舍
- 迁移风险：会话行为或打断语义回归。
- 工具链风险：构建/测试流程变化。

## 迁移计划
- 阶段 1：搭建 Node.js 项目骨架并迁移 WebSocket + 会话内核。
- 阶段 2：迁移音频/LLM/TTS/工具/观测占位实现以达成功能对齐。
- 阶段 3：移除 Python 运行时，更新文档并补齐测试。

## 未决问题
- 构建工具偏好：pnpm / npm / yarn?
- 代码规范：eslint + prettier 是否采用默认规则？