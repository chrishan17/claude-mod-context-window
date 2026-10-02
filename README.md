# context-window

A Claude Code mod that lists what is in the context window, in a side pane. It shows what the session loaded at startup, then every item added to the context after that, each with a short name and an estimated token count. It's for scanning the context quickly to check it holds what you expect.

```
20%  40k / 200k  claude-opus-5-5
████████░░░░░░░░░░░░░░░░░░░░░░░░
[ 时间线 ] [ 按类别 ] [ 刷新 ]

启动时载入                           13.3k
 ▸ ■ 系统提示词  14                   3.1k
 ▸ ■ MCP 工具  6                      9k
 ▸ ■ 记忆文件  2                      1.2k
     按需工具 240 个未载入，不占窗口

会话中加入  12 项 · 估算               26.7k
 ▸ ❯ 帮我做一个 claude code mod  5 项  8.2k
 ▾ ❯ 这个 skill 不是简单的显示…        18.5k
     + 系统注入 · 嵌套 CLAUDE.md  …/mod/CLAUDE.md  310
     ◆ Skill  plugin-authoring  +内容  6.1k
     ◆ Read  …/hooks/register.tsx      4.1k
     ✗ Bash  npm test                  9.4k
     ● The test fails because…         120
```

## What it records

The categories follow the split the official docs use (https://code.claude.com/docs/en/context-window): what is in context **from startup**, what is **loaded on demand**, and the **conversation** that builds up turn by turn.

**启动时载入 (startup; sent with every request).** These figures come from the same breakdown `/context` uses:

| Category | Contents |
| --- | --- |
| 系统提示词 (system prompt) | The system prompt's sections |
| 内置工具 (built-in tools) | Schemas of the built-in tools |
| MCP 工具 / MCP 服务说明 (MCP tools / server instructions) | Loaded tool schemas per server, and the servers' instructions |
| 记忆文件 (memory files) | CLAUDE.md files, rules and auto memory, each a clickable link |
| 技能描述 (skill descriptions) | The one-line **descriptions** of every skill; not the skills' bodies |

**按需加载 (loaded on demand).** These enter the context only when something uses them:

| Kind | Glyph | Contents |
| --- | --- | --- |
| 已加载技能 (loaded skills) | `✦` | A skill's full SKILL.md, loaded by the Skill tool or its slash command; its path links to the file |
| 文件与记忆 (files and memory) | `❐` | A nested CLAUDE.md found beside a file Claude read, an @-mentioned file, edit notices |
| 清单更新 (listing updates) | `☰` | Updates to the skill description list, the deferred tool list, MCP server instructions and agent types |
| 按需载入工具 (tools loaded on demand) | `+` | Tool schemas loaded through ToolSearch |

**对话消息 (conversation messages).** These are what each turn adds:

| Kind | Glyph | Contents |
| --- | --- | --- |
| 你的输入 (your prompt) | `❯` | Opens a turn |
| 工具调用 (tool calls) | `◆` (`✗` on error) | Tool name plus its key argument; file paths are links |
| 子代理 (subagent) | `❖` | Only its final result enters this window |
| 系统提醒 / Hook 输出 (system reminders / hook output) | `+` `↳` | Repeated identical reminders fold into one row marked `×N` |
| 模型回复 / 思考 (replies / thinking) | `●` `✻` | Dimmed; click `▸` to expand the full snippet. When a thinking block's text was returned, its first line and snippet are shown. When only an encrypted signature came back, the row says so, and its size is measured from the request's reported usage (output tokens minus visible text and tool calls), marked 按用量 (by usage) |
| 斜杠命令 / 消息投递 / 压缩摘要 (slash commands / deliveries / compaction summary) | `/` `»` `≡` | |

## Hierarchy

Each turn is a tree:

```
❯ your prompt
   + attached with this prompt: 12 items   (listings 4 · reminders 7 · files 1)
   ✦ skill plugin-authoring  …/plugin-authoring/SKILL.md
      ◆ Read  …/hooks/hooks.json            ← calls made while the skill was active
         ❐ nested CLAUDE.md  …/pkg/CLAUDE.md ← loaded because of this read
      ❖ Explore  find reduceRow             ← only its result is in this window
         ◆ Grep  …  (subagent window)        ← its own steps, not counted
         » subagent hand-back
   ● reply
```

How each level is assigned:
- **Under a skill:** tool calls, subagents and replies that come after a skill loads in the same turn hang under it. This is attribution by order: the skill's instructions were in force when those calls ran.
- **Under a file tool:** a nested CLAUDE.md or path-scoped rule loaded right after a Read, Edit, Write, Grep or Glob call hangs under that call.
- **Under ToolSearch:** tools it loaded hang under it. Listing updates that come from MCP servers connecting belong to no call.
- **Under an Agent call:** the subagent's own tool calls are marked "子代理窗口" (subagent window) and excluded from the totals; its hand-back hangs under the call too.
- **Hook output:** PreToolUse and PostToolUse output hangs under the tool call that triggered it.

Paths are rendered as `file://` links (OSC 8 in the terminal): click to open the file.

Token sizes over 5k are drawn in yellow and sizes over 20k in red.

## Views

Switch views with `1`–`6` while the pane has focus (ctrl+x then Tab), or click a label:

| Key | View | Question it answers |
| --- | --- | --- |
| `1` | 时间线 (timeline) | What came in, turn by turn, and what caused each item: skill → tool call → nested CLAUDE.md |
| `2` | 类别 (category) | How much each category takes: startup / loaded on demand / conversation, the official split |
| `3` | 排行 (top) | What takes the most room: every item, startup groups included, largest first, with a running share |
| `4` | 文件 (files) | Which files are in context: grouped by folder, with what was done to each (read, edited, searched, injected, memory, skill); a file read twice is flagged 重复读取 (read more than once) |
| `5` | 来源 (origin) | Who put it there: you, model output, tool results, skill bodies, subagents, engine injection, hooks, startup config; one stacked bar plus a row each |
| `6` | 增长 (growth) | Which turn grew the context: one stacked bar per turn, coloured by kind, with a running total |

`r` re-reads the figures.

## Install

Requires Claude Code 2.1.287 or later.

```
/plugin marketplace add chrishan17/claude-mod-context-window
/plugin install context-window@claude-mod-context-window
```

## Use

- The pane is a sidebar docked to the right of the transcript, which needs Claude Code's fullscreen layout. Start it with `CLAUDE_CODE_NO_FLICKER=1 claude`, or set that variable in the `env` block of `~/.claude/settings.json`.
- With the fullscreen layout, the pane opens by itself at session start when the terminal is at least 144 columns wide. On the normal layout it stays closed rather than taking space above the prompt.
- `/context-window` opens or closes it. On the normal layout it then opens above the prompt, with a hint about the sidebar.
- Keys while the pane has focus: `1`–`6` switch views (see above), `r` refreshes. Click `▸` to expand a row.

Notes:
- Startup sizes come from the same breakdown `/context` uses.
- Item sizes are local estimates; nothing extra is sent to the API.
- A resumed session is read back from its transcript, so the original attachment names are lost there.

## Language

The pane draws in Chinese or English. Set it with the plugin's `language` option (`auto` / `zh` / `en`) in `/config`, or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "context-window": { "options": { "language": "zh" } } } }
```

`auto` (the default) follows Claude Code's own `language` setting, then the system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`): a `zh*` locale gives Chinese, anything else gives English. Every string lives in `hooks/i18n.ts`, so adding a language means adding one dictionary there.

## Develop

```
claude plugin validate plugins/context-window
claude plugin test plugins/context-window
claude --plugin-dir plugins/context-window
```
