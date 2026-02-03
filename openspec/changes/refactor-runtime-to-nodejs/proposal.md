# 变更：迁移运行时到 Node.js（Fastify + TypeScript）

## 为什么
项目需要从 Python asyncio 全量迁移到 Node.js 运行时，以符合团队技术栈偏好，并在 Web/电话/编排/观测等模块上统一工具链。

## 变更内容
- 用 Node.js（Fastify + TypeScript）替换现有 Python 运行时。
- 用 TypeScript 重写统一会话内核、事件总线与状态机。
- 迁移适配器、音频链路、LLM/TTS 占位实现、工具框架与观测占位实现。
- 更新构建/运行脚本、依赖管理与项目结构。
- **破坏性变更**：当 Node.js 达到功能对齐后，移除或弃用 Python 入口（`main.py`、`src/**.py`）。

## 影响范围
- 影响规格：平台运行时 / 系统架构
- 影响代码：全部 `src/` Python 模块、`main.py` 与运行时工具链