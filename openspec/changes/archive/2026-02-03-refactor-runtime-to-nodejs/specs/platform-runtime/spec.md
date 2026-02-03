## ADDED Requirements
### Requirement: Node.js 运行时
系统 SHALL 运行于 Node.js，并使用 TypeScript 与 Fastify 作为主要 Web 框架。

#### Scenario: 运行时基线
- **WHEN** 系统完成构建并启动
- **THEN** 服务 SHALL 以 TypeScript 编译后的 Node.js 运行时启动，且由 Fastify 处理 WebSocket 接入

### Requirement: 全模块对齐
系统 SHALL 为现有所有模块提供 Node.js 实现（适配器、会话内核、音频链路、LLM/TTS 占位实现、工具、观测）。

#### Scenario: 对齐覆盖
- **WHEN** Node.js 迁移完成
- **THEN** 当前 Python 实现中存在的每个模块 SHALL 具备对应的 TypeScript 版本

### Requirement: Python 退场
当 Node.js 达成功能对齐后，系统 SHALL 移除或弃用 Python 入口。

#### Scenario: 迁移后清理
- **WHEN** Node.js 实现达到功能对齐
- **THEN** Python 运行时入口 SHALL 被移除或归档