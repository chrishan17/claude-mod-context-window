/**
 * What kind of thing entered the context, which sets how the pane draws it.
 *
 * - `prompt`     what the person typed
 * - `skill`      a skill's full body, loaded when it was invoked (Skill tool or
 *                its slash command); never the listing of skill descriptions
 * - `tool`       a tool call: its input and its result
 * - `agent`      an Agent call: only its final result enters this context
 * - `file`       a file's content the engine added: a nested CLAUDE.md found
 *                beside a file read, an @-mentioned file, an edit notice
 * - `listing`    a listing the engine keeps current: skill descriptions,
 *                deferred tool names, MCP server instructions, agent types
 * - `reminder`   a system reminder: environment, date, mode, todo, budget
 * - `hook`       a settings hook's added context
 * - `command`    a slash command's record and output
 * - `delivery`   a background task's or another agent's message
 * - `note`       a plugin's appended row
 * - `reply`      the model's text
 * - `thinking`   the model's thinking blocks
 * - `compaction` a compaction's boundary and summary
 * - `loaded`     tool schemas loaded on demand mid-session
 */
export type EntryKind =
  | 'prompt'
  | 'skill'
  | 'tool'
  | 'agent'
  | 'file'
  | 'listing'
  | 'reminder'
  | 'hook'
  | 'command'
  | 'delivery'
  | 'note'
  | 'reply'
  | 'thinking'
  | 'compaction'
  | 'loaded'

/** One thing that entered the context after the session started. */
export type Entry = {
  /** The row's uuid, or the tool_use id for a tool call. */
  id: string
  kind: EntryKind
  /**
   * The short name drawn first: a tool's name, a prompt's first words, or a
   * dictionary key (`entry.thinking`, `att.skill_listing`) drawn in the
   * pane's language.
   */
  label: string
  /** What fills `{0}` when `label` is a dictionary key. */
  labelArg?: string | number
  /** The dim text after it: a command, an attachment's first line, or a key. */
  detail?: string
  /** What fills `{0}` when `detail` is a dictionary key. */
  detailArg?: string | number
  /** An absolute file path the entry is about, drawn as a link. */
  path?: string
  /** Estimated tokens. */
  tokens: number
  /** The person's prompt this follows (0 before the first one). */
  turn: number
  /** Which compaction generation it belongs to; older ones are out of context. */
  epoch: number
  /**
   * The entry this one hangs under: the skill whose instructions were in
   * force, the tool call that triggered it, the Agent call that ran it.
   */
  parent?: string
  /** Lives in a subagent's own context window, not this one. */
  isOutside?: boolean
  /** The tool's name, for a `tool`, `skill` or `agent` entry. */
  tool?: string
  isError?: boolean
  /** A tool call whose result has not arrived yet. */
  isPending?: boolean
  /** How many identical reminders this one row stands for. */
  count?: number
  /** The opening of the text, shown when the row is opened (thinking, replies). */
  preview?: string
  /** `tokens` comes from the request's reported usage, not an estimate of text. */
  isMeasured?: boolean
}

/** Everything appended since the session started, with the counters. */
export type ContextLog = {
  entries: Entry[]
  turn: number
  epoch: number
  /** The skill loaded last in this turn: later tool calls hang under it. */
  activeSkill?: string
  /** The tool call whose result came last, for what it triggers next. */
  lastTool?: string
  /** Each subagent's id → the Agent call that started it. */
  agents: Record<string, string>
}

/** One item inside a startup group: a memory file, an MCP server, a skill. */
export type StartupItem = {
  /** A name, or a dictionary key drawn in the pane's language. */
  label: string
  detail?: string
  detailArg?: string | number
  /** An absolute file path, drawn as a link. */
  path?: string
  tokens: number
}

/** One category the context carried before the first prompt. */
export type StartupGroup = {
  /** The breakdown row's name (`System prompt`), or `context-blocks`. */
  key: string
  /** The dictionary key of its name (`group.System prompt`). */
  label: string
  /** A theme key, as /context colours the row. */
  color: string
  tokens: number
  items: StartupItem[]
  /** Names listed without sizes (built-in tools). */
  names?: string[]
}

/** What the session carried before anything was appended. */
export type Startup = {
  groups: StartupGroup[]
  /** Tool schemas available on demand, outside the window. */
  deferred: { count: number; tokens: number }
  /** MCP tools whose schema is in the window, to spot new loads. */
  loadedMcp: string[]
}

/** The window's fill, as the status line has it. */
export type Fill = {
  tokens?: number
  window: number
  percent?: number
  model?: string
  /**
   * `tokens` is /context's estimate, not a response's measure: no response yet
   * in this window (a fresh session, or one just compacted).
   */
  isEstimate?: boolean
}

export type PaneView = 'timeline' | 'category' | 'top' | 'files' | 'origin' | 'growth'

declare module 'claude-code' {
  interface PluginState {
    'context-window': {
      log: ContextLog
      startup: Startup | null
      sections: StartupItem[]
      contextBlocks: StartupItem[]
      /** The built-in tools the main loop's requests offer, by name. */
      tools: string[]
      fill: Fill | null
      view: PaneView
      toggled: string[]
      /** The person opened the pane with /context-window, so it may sit above the prompt. */
      asked: boolean
      /** The language the pane draws in, settled at session start. */
      lang: 'zh' | 'en'
    }
  }
}
