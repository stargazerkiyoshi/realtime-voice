# 变更：新增前端测试控制台（Vite + React + Ant Design）

## 为什么
需要一个可视化前端用于快速测试 WebSocket 语音链路、会话控制与日志观察，提升调试与验证效率。

## 变更内容
- 新增前端项目（Vite + React + Ant Design）。
- 提供会话连接/断开、开始/结束会话、日志展示等基础功能。
- 采用 React Router 进行路由，Zustand 进行全局状态管理。

## 影响范围
- 影响规格：前端测试台能力
- 影响代码：`frontend/` 目录与相关依赖