# context-window

A side pane listing what is in Claude Code's context window: what the session loaded at startup, then every item added after that, each with a short name and an estimated token count. The full guide is in the [repository README](../../README.md).

## What the mod reads and sends

The mod sends nothing anywhere. It makes no network requests and no API calls of its own; what it reads is only drawn in the pane.

What it reads, all on this machine:
- The conversation: the messages and tool calls as they enter the context, and on a resumed session the transcript (`$.session.messages`), to list and size them.
- Local settings and environment: Claude Code's `language` setting (`$.config.list`) and the locale variables `LC_ALL`, `LC_MESSAGES` and `LANG` (`$.env.get`), only to pick the pane's language.
- The window's usage and its startup breakdown (`$.session.usage`), the tool list (`$.tool.list`) and the agent list (`$.agent.list`).

The one call that may look like a way out is `$.prompt.compose` in `hooks/register.tsx`. It only assembles the system prompt locally so the pane can name its sections and their sizes; it does not send a request to the model, and its result is not passed anywhere.
