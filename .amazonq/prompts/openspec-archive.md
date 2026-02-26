---
description: 归档已部署的OpenSpec变更并更新规范。
---

The user wants to archive the following deployed change. Use the openspec instructions to archive the change and update specs.

<ChangeId>
  $ARGUMENTS
</ChangeId>
<!-- OPENSPEC:START -->
**护栏规则**
- 优先使用简单、最小的实现，仅在请求或明确需要时才添加复杂性。
- 将变更紧密限制在请求的结果范围内。
- 如果需要额外的OpenSpec约定或澄清，请参考`openspec/AGENTS.md`（位于`openspec/`目录中—如果看不到，请运行`ls openspec`或`openspec-cn update`）。

**步骤**
1. 确定要归档的变更ID：
   - 如果该提示已包含一个明确的变更ID（例如在由斜杠命令参数填充的 `<ChangeId>` 块中），请在去除首尾空白后直接使用该值。
   - 如果对话仅以标题或摘要等方式模糊引用了某个变更，请运行 `openspec-cn list` 找出可能的ID，列出相关候选项，并确认用户具体要归档哪一个。
   - 否则，请回顾对话、运行 `openspec-cn list`，并询问用户要归档哪个变更；在拿到确认的变更ID前不要继续。
   - 如果仍然无法确定唯一的变更ID，请停止并告知用户目前还无法归档任何内容。
2. 运行 `openspec-cn list`（或 `openspec-cn show <id>`）验证该变更ID；如果该变更不存在、已归档，或尚不适合归档，请停止。
3. 运行 `openspec-cn archive <id> --yes`，让CLI移动变更并在无提示的情况下应用规范更新（仅对仅工具工作使用`--skip-specs`）。
4. 检查命令输出，确认目标规范已更新，并且该变更已落入 `changes/archive/`。
5. 运行 `openspec-cn validate --strict --no-interactive` 进行验证；如果有任何异常，使用 `openspec-cn show <id>` 进一步检查。

**参考**
- 使用 `openspec-cn list` 在归档前确认变更ID。
- 使用 `openspec-cn list --specs` 检查刷新后的规范，并在交接前解决所有验证问题。
<!-- OPENSPEC:END -->
