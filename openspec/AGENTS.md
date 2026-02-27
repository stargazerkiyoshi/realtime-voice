# OpenSpec 使用说明

面向使用 OpenSpec 进行规范驱动开发的 AI 编码助手说明。

## 快速检查清单（TL;DR）

- 搜索现有工作：`openspec spec list --long`、`openspec list`（仅在全文检索时使用 `rg`）
- 判定范围：是新增能力，还是修改现有能力
- 选择唯一 `change-id`：kebab-case、动词前缀（`add-`、`update-`、`remove-`、`refactor-`）
- 搭建骨架：`proposal.md`、`tasks.md`、`design.md`（按需）以及受影响能力对应的 spec delta
- 编写 delta：使用 `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`，每条 requirement 至少包含一个 `#### Scenario:`
- 校验：运行 `openspec validate [change-id] --strict --no-interactive` 并修复问题
- 请求审批：提案获批前不要开始实施

## 三阶段工作流

### 阶段 1：创建变更
在以下情况需要创建提案：
- 新增特性或功能
- 引入破坏性变更（API、数据结构等）
- 调整架构或设计模式
- 性能优化且会改变行为
- 更新安全模式

触发词（示例）：
- "Help me create a change proposal"
- "Help me plan a change"
- "Help me create a proposal"
- "I want to create a spec proposal"
- "I want to create a spec"

宽松匹配规则：
- 包含以下任一词：`proposal`、`change`、`spec`
- 且同时包含：`create`、`plan`、`make`、`start`、`help` 之一

以下场景可跳过提案：
- Bug 修复（恢复既有预期行为）
- 拼写、格式、注释类修改
- 依赖升级（非破坏性）
- 配置变更
- 仅补充现有行为测试

**工作流程**
1. 阅读 `openspec/project.md`、`openspec list`、`openspec list --specs` 了解当前上下文。
2. 选择唯一且动词开头的 `change-id`，并在 `openspec/changes/<id>/` 下搭建 `proposal.md`、`tasks.md`、可选 `design.md` 与 spec delta。
3. 按 `## ADDED|MODIFIED|REMOVED Requirements` 编写 delta，每条 requirement 至少包含一个 `#### Scenario:`。
4. 运行 `openspec validate <id> --strict --no-interactive` 并修复问题后再共享提案。

### 阶段 2：实施变更
将以下步骤作为 TODO 并逐项完成。
1. **阅读 proposal.md** - 理解要构建的内容
2. **阅读 design.md**（如存在）- 理解技术决策
3. **阅读 tasks.md** - 获取实施清单
4. **按顺序实施任务** - 逐项完成
5. **确认完成情况** - 更新状态前确保 `tasks.md` 中每项都已完成
6. **更新清单勾选** - 全部完成后将任务设为 `- [x]`，保证列表真实反映状态
7. **审批门禁** - 提案评审并批准前不要开始实施

### 阶段 3：归档变更
部署后，创建独立 PR 用于：
- 将 `changes/[name]/` 移动到 `changes/archive/YYYY-MM-DD-[name]/`
- 若能力有变，更新 `specs/`
- 对仅工具链变更使用 `openspec archive <change-id> --skip-specs --yes`（务必显式传入 change ID）
- 运行 `openspec validate --strict --no-interactive` 确认归档后通过校验

## 开始任何任务前

**上下文检查清单：**
- [ ] 阅读 `specs/[capability]/spec.md` 中相关规范
- [ ] 检查 `changes/` 中待处理变更是否冲突
- [ ] 阅读 `openspec/project.md` 了解项目约定
- [ ] 运行 `openspec list` 查看活动变更
- [ ] 运行 `openspec list --specs` 查看现有能力

**创建规范前：**
- 先确认能力是否已存在
- 优先修改现有规范，避免重复创建
- 使用 `openspec show [spec]` 查看当前状态
- 若需求不明确，搭建前先问 1-2 个澄清问题

### 检索指引
- 枚举规范：`openspec spec list --long`（脚本场景可用 `--json`）
- 枚举变更：`openspec list`（或 `openspec change list --json`，已废弃但可用）
- 查看详情：
  - 规范：`openspec show <spec-id> --type spec`（筛选时可用 `--json`）
  - 变更：`openspec show <change-id> --json --deltas-only`
- 全文检索（使用 ripgrep）：`rg -n "Requirement:|Scenario:" openspec/specs`

## 快速开始

### CLI 命令

```bash
# 核心命令
openspec list                  # 列出活动变更
openspec list --specs          # 列出规范
openspec show [item]           # 显示 change 或 spec
openspec validate [item]       # 校验 change 或 spec
openspec archive <change-id> [--yes|-y]   # 部署后归档（非交互场景加 --yes）

# 项目管理
openspec init [path]           # 初始化 OpenSpec
openspec update [path]         # 更新说明文件

# 交互模式
openspec show                  # 交互式选择
openspec validate              # 批量校验模式

# 调试
openspec show [change] --json --deltas-only
openspec validate [change] --strict --no-interactive
```

### 命令参数

- `--json` - 机器可读输出
- `--type change|spec` - 消除对象歧义
- `--strict` - 严格全面校验
- `--no-interactive` - 禁用交互提示
- `--skip-specs` - 归档时跳过 spec 更新
- `--yes`/`-y` - 跳过确认提示（非交互归档）

## 目录结构

```
openspec/
├── project.md              # 项目约定
├── specs/                  # 当前事实：已经构建的内容
│   └── [capability]/       # 单一聚焦能力
│       ├── spec.md         # 需求与场景
│       └── design.md       # 技术模式
├── changes/                # 提案：计划变更的内容
│   ├── [change-name]/
│   │   ├── proposal.md     # 为什么改、改什么、影响面
│   │   ├── tasks.md        # 实施清单
│   │   ├── design.md       # 技术决策（可选；见判定条件）
│   │   └── specs/          # Delta 变更
│   │       └── [capability]/
│   │           └── spec.md # ADDED/MODIFIED/REMOVED
│   └── archive/            # 已完成变更
```

## 创建变更提案

### 决策树

```
新需求？
├─ 是恢复既有规范行为的 bug 修复？→ 直接修复
├─ 是拼写/格式/注释？→ 直接修复
├─ 是新增功能/能力？→ 创建提案
├─ 是破坏性变更？→ 创建提案
├─ 是架构调整？→ 创建提案
└─ 需求不明确？→ 创建提案（更安全）
```

### 提案结构

1. **创建目录：**`changes/[change-id]/`（kebab-case、动词前缀、保证唯一）

2. **编写 proposal.md：**
```markdown
# 变更：[简要描述]

## 为什么
[用 1-2 句话描述问题/机会]

## 变更内容
- [列出变更点]
- [破坏性变更请用 **BREAKING** 标注]

## 影响
- Affected specs: [受影响能力列表]
- Affected code: [关键文件/系统]
```

3. **创建 spec delta：**`specs/[capability]/spec.md`
```markdown
## ADDED Requirements
### Requirement: New Feature
The system SHALL provide...

#### Scenario: Success case
- **WHEN** user performs action
- **THEN** expected result

## MODIFIED Requirements
### Requirement: Existing Feature
[Complete modified requirement]

## REMOVED Requirements
### Requirement: Old Feature
**Reason**: [Why removing]
**Migration**: [How to handle]
```
如果影响多个 capability，请在 `changes/[change-id]/specs/<capability>/spec.md` 下分别创建多个 delta 文件（每个 capability 一个）。

4. **创建 tasks.md：**
```markdown
## 1. 实施
- [ ] 1.1 创建数据库结构
- [ ] 1.2 实现 API 接口
- [ ] 1.3 新增前端组件
- [ ] 1.4 编写测试
```

5. **按需创建 design.md：**
若满足以下任一条件请创建 `design.md`，否则可省略：
- 跨模块/跨服务改动，或引入新的架构模式
- 新外部依赖，或较大的数据模型变更
- 涉及安全、性能或迁移复杂度
- 在编码前需要先明确技术决策

最小 `design.md` 骨架：
```markdown
## 背景
[背景、约束、相关方]

## 目标 / 非目标
- 目标：[]
- 非目标：[]

## 决策
- 决策：[做什么、为什么]
- 备选方案：[选项 + 取舍原因]

## 风险 / 取舍
- [风险] → [缓解措施]

## 迁移计划
[步骤、回滚方案]

## 未决问题
- [...]
```

## 规范文件格式

### 关键：Scenario 格式

**正确示例**（使用 `####` 标题）:
```markdown
#### Scenario: 用户登录成功
- **WHEN** 提供有效凭据
- **THEN** 返回 JWT token
```

**错误示例**（不要用列表或加粗充当场景标题）:
```markdown
- **Scenario: User login**  ❌
**Scenario**: User login     ❌
### Scenario: User login      ❌
```

每条 requirement 必须至少包含一个 scenario。

### Requirement 写法
- 规范性 requirement 使用 SHALL/MUST（除非有意写成非规范性表述，否则避免 should/may）

### Delta 操作

- `## ADDED Requirements` - 新增能力
- `## MODIFIED Requirements` - 行为变更
- `## REMOVED Requirements` - 废弃能力
- `## RENAMED Requirements` - 名称变更

Header 按 `trim(header)` 匹配，即忽略首尾空白。

#### 何时使用 ADDED 与 MODIFIED
- ADDED：引入可以独立成立的新能力或子能力。若变更与现有 requirement 语义正交（例如新增 “Slash Command Configuration”），优先使用 ADDED。
- MODIFIED：修改现有 requirement 的行为、范围或验收标准。务必粘贴完整、更新后的 requirement 内容（header + 全部 scenarios）。归档器会用你提供的内容替换整条 requirement；部分 delta 会导致旧细节丢失。
- RENAMED：仅名称变化时使用。若同时改行为，应使用 RENAMED（改名）+ MODIFIED（改内容，引用新名称）。

常见陷阱：使用 MODIFIED 添加新关注点却没有包含旧文本。这会在归档时丢失细节。若你不是显式修改现有 requirement，请改为在 ADDED 下新增 requirement。

正确编写 MODIFIED requirement：
1) 在 `openspec/specs/<capability>/spec.md` 中定位现有 requirement。
2) 复制整段 requirement（从 `### Requirement: ...` 到其全部 scenarios）。
3) 粘贴到 `## MODIFIED Requirements` 下，并按新行为编辑。
4) 确保 header 文本精确匹配（忽略空白差异），并至少保留一个 `#### Scenario:`。

RENAMED 示例：
```markdown
## RENAMED Requirements
- FROM: `### Requirement: Login`
- TO: `### Requirement: User Authentication`
```

## 故障排查

### 常见错误

**“Change must have at least one delta”**
- 检查 `changes/[name]/specs/` 是否存在且包含 .md 文件
- 检查文件是否包含操作前缀（如 `## ADDED Requirements`）

**“Requirement must have at least one scenario”**
- 检查 scenario 是否使用 `#### Scenario:` 格式（4 个 `#`）
- 不要用列表项或加粗文本替代 scenario 标题

**scenario 被静默解析失败**
- 必须严格使用：`#### Scenario: Name`
- 可用 `openspec show [change] --json --deltas-only` 调试

### 校验建议

```bash
# Always use strict mode for comprehensive checks
openspec validate [change] --strict --no-interactive

# Debug delta parsing
openspec show [change] --json | jq '.deltas'

# Check specific requirement
openspec show [spec] --json -r 1
```

## 标准流程脚本

```bash
# 1) Explore current state
openspec spec list --long
openspec list
# Optional full-text search:
# rg -n "Requirement:|Scenario:" openspec/specs
# rg -n "^#|Requirement:" openspec/changes

# 2) Choose change id and scaffold
CHANGE=add-two-factor-auth
mkdir -p openspec/changes/$CHANGE/{specs/auth}
printf "## Why\n...\n\n## What Changes\n- ...\n\n## Impact\n- ...\n" > openspec/changes/$CHANGE/proposal.md
printf "## 1. Implementation\n- [ ] 1.1 ...\n" > openspec/changes/$CHANGE/tasks.md

# 3) Add deltas (example)
cat > openspec/changes/$CHANGE/specs/auth/spec.md << 'EOF'
## ADDED Requirements
### Requirement: Two-Factor Authentication
Users MUST provide a second factor during login.

#### Scenario: OTP required
- **WHEN** valid credentials are provided
- **THEN** an OTP challenge is required
EOF

# 4) Validate
openspec validate $CHANGE --strict --no-interactive
```

## 多能力示例

```
openspec/changes/add-2fa-notify/
├── proposal.md
├── tasks.md
└── specs/
    ├── auth/
    │   └── spec.md   # ADDED: Two-Factor Authentication
    └── notifications/
        └── spec.md   # ADDED: OTP email notification
```

auth/spec.md
```markdown
## ADDED Requirements
### Requirement: Two-Factor Authentication
...
```

notifications/spec.md
```markdown
## ADDED Requirements
### Requirement: OTP Email Notification
...
```

## 最佳实践

### 简洁优先
- 新增代码默认控制在 100 行以内
- 在证据不足前优先单文件实现
- 无明确收益时避免引入新框架
- 选择成熟稳定的方案

### 复杂度触发条件
仅在以下情况下引入复杂度：
- 有性能数据证明现方案过慢
- 有明确规模要求（>1000 用户、>100MB 数据）
- 有多个已验证场景需要抽象

### 清晰引用
- 代码位置使用 `file.ts:42` 格式
- 规范引用使用 `specs/auth/spec.md`
- 关联相关 change 和 PR

### 能力命名
- 使用动词-名词命名：`user-auth`、`payment-capture`
- 每个 capability 聚焦单一目的
- 遵循“10 分钟可理解”原则
- 描述中出现 “AND” 时考虑拆分

### Change ID 命名
- 使用 kebab-case，简短且可描述：`add-two-factor-auth`
- 优先使用动词前缀：`add-`、`update-`、`remove-`、`refactor-`
- 确保唯一；若冲突可追加 `-2`、`-3` 等

## 工具选择指南

| 任务 | 工具 | 原因 |
|------|------|-----|
| 按模式找文件 | Glob | 快速模式匹配 |
| 搜索代码内容 | Grep | 优化的正则检索 |
| 读取指定文件 | Read | 直接文件访问 |
| 探索未知范围 | Task | 多步骤调查 |

## 错误恢复

### 变更冲突
1. 运行 `openspec list` 查看活动变更
2. 检查是否存在重叠规格
3. 与变更负责人协调
4. 评估是否合并提案

### 校验失败
1. 使用 `--strict` 运行
2. 查看 JSON 输出定位细节
3. 校验 spec 文件格式
4. 确保 scenario 格式正确

### 上下文缺失
1. 先阅读 `project.md`
2. 检查相关 specs
3. 查看近期归档
4. 请求澄清

## 快速参考

### 阶段指示
- `changes/` - 已提案，尚未构建
- `specs/` - 已实现并部署
- `archive/` - 已完成变更

### 文件用途
- `proposal.md` - 为什么做、要做什么
- `tasks.md` - 实施步骤
- `design.md` - 技术决策
- `spec.md` - 需求与行为

### CLI 关键命令
```bash
openspec list              # 当前在推进什么？
openspec show [item]       # 查看详情
openspec validate --strict --no-interactive  # 是否正确？
openspec archive <change-id> [--yes|-y]  # 标记完成（自动化场景加 --yes）
```

请记住：Specs 是事实，Changes 是提案，二者要保持同步。
