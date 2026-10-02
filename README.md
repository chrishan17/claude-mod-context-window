# context-window

A Claude Code mod that lists what is in the context window, in a side pane. It shows what the session loaded at startup, then every item added to the context after that, each with a short name and an estimated token count. It's for scanning the context quickly to check it holds what you expect.

```
20%  40k / 200k  claude-opus-5-5
████████░░░░░░░░░░░░░░░░░░░░░░░░
[ Timeline ] [ Kinds ] [ Refresh ]

Loaded at startup                           13.3k
 ▸ ■ System prompt  14                       3.1k
 ▸ ■ MCP tools  6                              9k
 ▸ ■ Memory files  2                         1.2k
     240 deferred tools not loaded; names only

Added this session  12 items · estimated    26.7k
 ▸ ❯ build me a claude code mod  5 items     8.2k
 ▾ ❯ this skill isn't just a display…       18.5k
     + System reminder · Nested CLAUDE.md  …/mod/CLAUDE.md  310
     ◆ Skill  plugin-authoring  +body         6.1k
     ◆ Read  …/hooks/register.tsx             4.1k
     ✗ Bash  npm test                         9.4k
     ● The test fails because…                120
```
## What it records

The categories follow the split the official docs use (https://code.claude.com/docs/en/context-window): what is in context **from startup**, what is **loaded on demand**, and the **conversation** that builds up turn by turn.

**Loaded at startup (sent with every request).** These figures come from the same breakdown `/context` uses:

| Category | Contents |
| --- | --- |
| System prompt | The system prompt's sections |
| Built-in tools | Schemas of the built-in tools |
| MCP tools / MCP server instructions | Loaded tool schemas per server, and the servers' instructions |
| Memory files | CLAUDE.md files, rules and auto memory, each a clickable link |
| Skill descriptions | The one-line **descriptions** of every skill; not the skills' bodies |

**Loaded on demand.** These enter the context only when something uses them:

| Kind | Glyph | Contents |
| --- | --- | --- |
| Loaded skills | `✦` | A skill's full SKILL.md, loaded by the Skill tool or its slash command; its path links to the file |
| Files & memory | `❐` | A nested CLAUDE.md found beside a file Claude read, an @-mentioned file, edit notices |
| Listing updates | `☰` | Updates to the skill description list, the deferred tool list, MCP server instructions and agent types |
| Tools loaded on demand | `+` | Tool schemas loaded through ToolSearch |

**Conversation.** These are what each turn adds:

| Kind | Glyph | Contents |
| --- | --- | --- |
| Your prompts | `❯` | Opens a turn |
| Tool calls | `◆` (`✗` on error) | Tool name plus its key argument; file paths are links |
| Subagents | `❖` | Only its final result enters this window |
| System reminders / Hook output | `+` `↳` | Repeated identical reminders fold into one row marked `×N` |
| Replies / Thinking | `●` `✻` | Dimmed; click `▸` to expand the full snippet. When a thinking block's text was returned, its first line and snippet are shown. When only an encrypted signature came back, the row says so, and its size is measured from the request's reported usage (output tokens minus visible text and tool calls), marked "by usage" |
| Slash commands / Deliveries / Compaction summary | `/` `»` `≡` | |

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
- **Under an Agent call:** the subagent's own tool calls are marked "subagent window" and excluded from the totals; its hand-back hangs under the call too.
- **Hook output:** PreToolUse and PostToolUse output hangs under the tool call that triggered it.

Paths are rendered as `file://` links (OSC 8 in the terminal): click to open the file.

Token sizes over 5k are drawn in yellow and sizes over 20k in red.

## Views

Switch views with `1`–`6` while the pane has focus (ctrl+x then Tab), or click a label:

| Key | View | Question it answers |
| --- | --- | --- |
| `1` | Timeline | What came in, turn by turn, and what caused each item: skill → tool call → nested CLAUDE.md |
| `2` | Kinds | How much each category takes: startup / loaded on demand / conversation, the official split |
| `3` | Top | What takes the most room: every item, startup groups included, largest first, with a running share |
| `4` | Files | Which files are in context: grouped by folder, with what was done to each (read, edited, searched, injected, memory, skill); a file read twice is flagged "read again" |
| `5` | Origin | Who put it there: you, model output, tool results, skill bodies, subagents, engine injection, hooks, startup config; one stacked bar plus a row each |
| `6` | Growth | Which turn grew the context: one stacked bar per turn, coloured by kind, with a running total |

`r` re-reads the figures.

## What the mod reads and sends

The mod sends nothing anywhere. It makes no network requests and no API calls of its own; what it reads is only drawn in the pane.

What it reads, all on this machine:
- The conversation: the messages and tool calls as they enter the context, and on a resumed session the transcript (`$.session.messages`), to list and size them.
- Local settings and environment: Claude Code's `language` setting (`$.config.list`) and the locale variables `LC_ALL`, `LC_MESSAGES` and `LANG` (`$.env.get`), only to pick the pane's language.
- The window's usage and its startup breakdown (`$.session.usage`), the tool list (`$.tool.list`) and the agent list (`$.agent.list`).

The one call that may look like a way out is `$.prompt.compose` in `hooks/register.tsx`. It only assembles the system prompt locally so the pane can name its sections and their sizes; it does not send a request to the model, and its result is not passed anywhere.

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

The pane draws in Chinese or English. Set it with the plugin's `language` option (`auto`, `zh` or `en`; any other value counts as `auto`) in `/config`, or in `~/.claude/settings.json`:

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
