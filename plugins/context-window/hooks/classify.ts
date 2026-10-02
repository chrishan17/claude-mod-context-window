import type { SessionContextBreakdown } from 'claude-code'

import type { ContextLog, Entry, Startup, StartupGroup, StartupItem } from '../types'
import { hasKey } from './i18n'

/** A content block as the Messages API spells it. */
export type Block = { type: string; [field: string]: unknown }

/** The parts of a `session.append` input the log reads. */
export type Row = {
  door: string
  uuid: string
  origin: { kind: string; [field: string]: unknown }
  message: { type: string; name?: string; role?: string; isMeta?: true; content: readonly Block[] }
  agentId?: string
}

export const EMPTY_LOG: ContextLog = { entries: [], turn: 0, epoch: 0, agents: {} }

const MAX_ENTRIES = 1000
const IMAGE_TOKENS = 1600
const DOCUMENT_TOKENS = 3000
const WIDE = /[⺀-鿿가-힯豈-﫿＀-￯]/g

/** Rough tokens for text: a CJK character is about one, Latin about 3.6 chars. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const wide = text.match(WIDE)?.length ?? 0

  return Math.ceil(wide + (text.length - wide) / 3.6)
}

export function blockTokens(block: Block): number {
  switch (block.type) {
    case 'text':
      return estimateTokens(str(block.text))
    case 'thinking':
      return estimateTokens(str(block.thinking))
    case 'redacted_thinking':
      return Math.ceil(str(block.data).length / 4)
    case 'tool_use':
      return estimateTokens(str(block.name) + JSON.stringify(block.input ?? {}))
    case 'tool_result':
      return contentTokens(block.content)
    case 'image':
      return IMAGE_TOKENS
    case 'document':
      return DOCUMENT_TOKENS
    default:
      return estimateTokens(JSON.stringify(block))
  }
}

function contentTokens(content: unknown): number {
  if (typeof content === 'string') return estimateTokens(content)
  if (Array.isArray(content)) return content.reduce((sum: number, one) => sum + blockTokens(one as Block), 0)

  return 0
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The first meaningful line of a text, tags and blank lines skipped. */
export function firstLine(text: string, max = 60): string {
  const lines = text
    .replace(/<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim())
    .filter(line => line.length > 0 && !/^[#>*\-=`|]+$/.test(line))
  const line = lines[0] ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function textOf(blocks: readonly Block[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => str(block.text))
    .join('\n')
}

/** The last two segments of a path, `~` for the home directory. */
export function shortPath(path: string): string {
  const parts = path.replace(/^\/Users\/[^/]+/, '~').split('/').filter(Boolean)

  return parts.length <= 2 ? parts.join('/') || path : `…/${parts.slice(-2).join('/')}`
}

/** `mcp__claude_ai_Datadog__search_logs` → `Datadog·search_logs`. */
export function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!mcp) return name
  const server = (mcp[1] ?? '').replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '')

  return `${server}·${mcp[2]}`
}

/** The one argument that says what a tool call was about. */
export function toolDetail(name: string, input: Record<string, unknown>): string | undefined {
  const s = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const path = s('file_path') ?? s('notebook_path')
      return path && shortPath(path)
    }
    case 'Bash':
      return firstLine(s('command') ?? '', 50)
    case 'Grep':
    case 'Glob':
      return s('pattern')
    case 'WebFetch': {
      const url = s('url') ?? ''
      return url.replace(/^https?:\/\//, '').slice(0, 50)
    }
    case 'WebSearch':
    case 'ToolSearch':
      return s('query')
    case 'Agent':
    case 'Task':
      return s('description') ?? s('subagent_type')
    case 'Skill':
      return s('skill')
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} todos` : undefined
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim()) return firstLine(value, 50)
  }

  return undefined
}

/** Attachments that carry a file's or a memory's content, by name. */
const FILE_ATTACHMENTS = new Set([
  'nested_memory', 'memory', 'relevant_memories', 'instructions', 'file', 'directory', 'pdf_reference',
  'edited_text_file', 'edited_image_file', 'compact_file_reference', 'selected_lines_in_ide',
  'opened_file_in_ide', 'mcp_resource',
])

/** Attachments that carry a listing the engine keeps current. */
const LISTING_ATTACHMENTS = new Set([
  'skill_listing', 'deferred_tools_delta', 'mcp_instructions', 'mcp_instructions_delta',
  'agent_listing_delta', 'invoked_skills',
])

function attachmentKey(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * What an attachment is and its label: the dictionary key `att.<name>` when
 * the pane knows the name, else the name itself, readable.
 */
export function attachmentKind(name: string | undefined): { kind: 'file' | 'listing' | 'reminder'; label: string } {
  const key = attachmentKey(name)
  const kind = FILE_ATTACHMENTS.has(key) ? 'file' : LISTING_ATTACHMENTS.has(key) ? 'listing' : 'reminder'
  const label = !key ? 'entry.reminder' : hasKey(`att.${key}`) ? `att.${key}` : (name ?? '').replace(/_/g, ' ')

  return { kind, label }
}

/** The first absolute path a text names (`Contents of /a/b/CLAUDE.md:`). */
export function pathIn(text: string): string | undefined {
  const path = /(?:^|[\s(])(\/(?:[^\s:'"`<>()]+\/)*[^\s:'"`<>()]+)/m.exec(text)?.[1]

  return path?.replace(/[.,;]+$/, '')
}

const SKILL_BASE = /Base directory for this skill:\s*(\S+)/

/** A skill's body names its folder: its SKILL.md is the file to open. */
export function skillPath(text: string): string | undefined {
  const dir = SKILL_BASE.exec(text)?.[1]

  return dir ? `${dir.replace(/\/$/, '')}/SKILL.md` : undefined
}

function commandName(text: string): string | undefined {
  return /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text)?.[1]
}

function toolPath(name: string, input: Record<string, unknown>): string | undefined {
  const s = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return s('file_path')
    case 'NotebookEdit':
      return s('notebook_path')
    case 'Grep':
    case 'Glob':
      return s('path')
  }

  return undefined
}

const TOOL_HOOKS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch'])

/** Tools that touch files: what the engine loads beside a file hangs under them. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob'])

/** A subagent's report handed back into this conversation. */
const HAND_BACK = /Subagent hand-back|^Another Claude session sent a message/m

/**
 * Folds one appended row into the log: new entries, or tokens merged into the
 * call they belong to, each hung under what caused it. Notices and rows no
 * request carries change nothing; a subagent's rows land under its Agent call,
 * marked as outside this window.
 */
export function reduceRow(log: ContextLog, row: Row): ContextLog {
  const { door, message, uuid } = row
  const blocks = message.content
  const entries = [...log.entries]
  let { turn, epoch, activeSkill, lastTool } = log
  const agents = log.agents ?? {}
  const done = () => cap({ entries, turn, epoch, activeSkill, lastTool, agents })
  // A row that carries nothing (a hook that only reported success, an empty
  // thinking block) takes no room: leave it out so the list stays readable.
  const add = (entry: Omit<Entry, 'turn' | 'epoch'>) => {
    if (entry.tokens > 0 || ['compaction', 'prompt', 'command', 'skill', 'agent', 'thinking'].includes(entry.kind) || entry.isPending) {
      entries.push({ ...entry, turn, epoch })
    }
  }
  const merge = (id: string, change: (entry: Entry) => Entry) => {
    const at = findLast(entries, entry => entry.id === id)
    if (at < 0) return false
    entries[at] = change(entries[at] as Entry)
    return true
  }
  const text = textOf(blocks)
  const tokens = blocks.reduce((sum, block) => sum + blockTokens(block), 0)

  if (row.agentId) {
    const parent = agents[row.agentId]
    if (!parent) return log
    if (door === 'response') {
      for (const block of blocks) {
        if (block.type !== 'tool_use') continue
        const name = str(block.name)
        const input = (block.input ?? {}) as Record<string, unknown>
        add({
          id: str(block.id) || `${uuid}:${name}`,
          kind: 'tool',
          tool: name,
          label: toolLabel(name),
          detail: toolDetail(name, input),
          path: toolPath(name, input),
          tokens: blockTokens(block),
          parent,
          isOutside: true,
        })
      }
    } else if (door === 'tool-result') {
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        merge(str(block.tool_use_id), entry => ({ ...entry, tokens: entry.tokens + blockTokens(block), isError: block.is_error === true || undefined }))
      }
    }
    return done()
  }

  if (door === 'compaction') {
    activeSkill = undefined
    lastTool = undefined
    if (message.type === 'system' || !message.role) {
      epoch += 1
      add({ id: uuid, kind: 'compaction', label: 'entry.compacted', tokens: 0 })
    } else {
      const last = entries[entries.length - 1]
      if (last?.kind === 'compaction' && last.epoch === epoch) {
        entries[entries.length - 1] = { ...last, label: 'entry.compactSummary', tokens: last.tokens + tokens }
      } else {
        add({ id: uuid, kind: 'compaction', label: 'entry.compactSummary', tokens })
      }
    }
    return done()
  }
  if (door === 'notice' || !message.role) return log

  // A skill's body, however it arrived: the Skill tool's hand-over, or the
  // meta row after the person typed the skill's slash command.
  const bodyPath = skillPath(text)
  if (bodyPath && door !== 'response') {
    const at = findLast(entries, entry => entry.kind === 'skill' && entry.turn === turn)
    const last = entries[entries.length - 1]
    if (at >= 0 && (door === 'tool-message' || door === 'tool-result')) {
      const skill = entries[at] as Entry
      entries[at] = { ...skill, tokens: skill.tokens + tokens, path: bodyPath, isPending: undefined }
      activeSkill = skill.id
    } else if (last?.kind === 'command' && last.turn === turn) {
      entries[entries.length - 1] = { ...last, kind: 'skill', tool: 'command', label: last.label.replace(/^\//, ''), detail: 'entry.skillByCommand', tokens: last.tokens + tokens, path: bodyPath }
      activeSkill = last.id
    } else {
      const name = bodyPath.split('/').slice(-2, -1)[0] ?? 'skill'
      add({ id: uuid, kind: 'skill', label: name, tokens, path: bodyPath })
      activeSkill = uuid
    }
    return done()
  }

  switch (door) {
    case 'prompt': {
      if (row.origin.kind === 'task-notification') {
        add({ id: uuid, kind: 'delivery', label: 'entry.taskNotice', detail: firstLine(text, 50) || undefined, tokens })
        break
      }
      if (message.isMeta && HAND_BACK.test(text)) {
        const agent = findLast(entries, entry => entry.kind === 'agent' && entry.turn === turn)
        add({
          id: uuid,
          kind: 'delivery',
          label: 'entry.handBack',
          detail: firstLine(text.replace(HAND_BACK, ''), 50) || undefined,
          tokens,
          parent: agent >= 0 ? (entries[agent] as Entry).id : undefined,
        })
        break
      }
      if (message.isMeta) {
        add({ id: uuid, kind: 'reminder', label: 'entry.metaMessage', detail: firstLine(text, 50) || undefined, tokens })
        break
      }
      turn += 1
      activeSkill = undefined
      lastTool = undefined
      add({
        id: uuid,
        kind: 'prompt',
        label: firstLine(text, 60) || 'entry.empty',
        detail: row.origin.kind === 'scheduled-trigger' ? 'entry.scheduled' : undefined,
        tokens,
      })
      break
    }
    case 'command': {
      const name = commandName(text)
      const last = entries[entries.length - 1]
      if (!name && (last?.kind === 'command' || last?.kind === 'skill') && last.turn === turn) {
        entries[entries.length - 1] = { ...last, tokens: last.tokens + tokens }
        break
      }
      if (name) {
        turn += 1
        activeSkill = undefined
        lastTool = undefined
      }
      add({
        id: uuid,
        kind: 'command',
        label: name ? `/${name}` : 'entry.commandOutput',
        detail: name ? firstLine(/<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? '', 40) || undefined : undefined,
        tokens,
      })
      break
    }
    case 'response': {
      lastTool = undefined
      for (const [index, block] of blocks.entries()) {
        const id = `${uuid}:${index}`
        if (block.type === 'tool_use') {
          const name = str(block.name)
          const input = (block.input ?? {}) as Record<string, unknown>
          const callId = str(block.id) || id
          if (name === 'Skill') {
            add({ id: callId, kind: 'skill', tool: name, label: str(input.skill) || 'skill', detail: str(input.args) || undefined, tokens: blockTokens(block), isPending: true })
            activeSkill = callId
          } else if (name === 'Agent' || name === 'Task') {
            add({
              id: callId,
              kind: 'agent',
              tool: name,
              label: str(input.subagent_type) || 'Agent',
              detail: str(input.description) || undefined,
              tokens: blockTokens(block),
              parent: activeSkill,
              isPending: true,
            })
          } else {
            add({
              id: callId,
              kind: 'tool',
              tool: name,
              label: toolLabel(name),
              detail: toolDetail(name, input),
              path: toolPath(name, input),
              tokens: blockTokens(block),
              parent: activeSkill,
              isPending: true,
            })
          }
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          // The API may hand thinking back as a signature alone: its words are
          // then not readable here, and its size comes from the step's usage.
          const words = str(block.thinking).trim()
          add({
            id,
            kind: 'thinking',
            label: 'entry.thinking',
            detail: block.type === 'redacted_thinking' ? 'entry.redacted' : words ? firstLine(words, 60) : 'entry.thinkingSealed',
            preview: words ? preview(words) : undefined,
            tokens: words ? estimateTokens(words) : 0,
            parent: activeSkill,
          })
        } else {
          const body = block.type === 'text' ? str(block.text) : ''
          const line = block.type === 'text' ? firstLine(body, 60) : block.type
          if (!line) continue
          add({
            id,
            kind: 'reply',
            label: line,
            preview: body.length > line.length + 20 ? preview(body) : undefined,
            tokens: blockTokens(block),
            parent: activeSkill,
          })
        }
      }
      break
    }
    case 'tool-result': {
      let rest = 0
      for (const block of blocks) {
        if (block.type !== 'tool_result') {
          rest += blockTokens(block)
          continue
        }
        const id = str(block.tool_use_id)
        const size = blockTokens(block)
        const isError = block.is_error === true || undefined
        const found = merge(id, entry => ({ ...entry, tokens: entry.tokens + size, isPending: undefined, isError }))
        if (!found) {
          const tool = str(row.origin.tool) || 'tool'
          add({ id: id || uuid, kind: 'tool', tool, label: toolLabel(tool), tokens: size, isError, parent: activeSkill })
        }
        lastTool = id || uuid
      }
      if (rest > 0 && lastTool) merge(lastTool, entry => ({ ...entry, tokens: entry.tokens + rest }))
      break
    }
    case 'tool-message': {
      const tool = str(row.origin.tool)
      const at = findLast(entries, entry => entry.tool === tool && entry.turn === turn)
      if (at >= 0) {
        const call = entries[at] as Entry
        entries[at] = { ...call, tokens: call.tokens + tokens }
      } else {
        add({ id: uuid, kind: 'tool', tool, label: toolLabel(tool || 'tool'), detail: firstLine(text, 50) || undefined, tokens, parent: activeSkill })
      }
      break
    }
    case 'delivery':
      add({ id: uuid, kind: 'delivery', label: 'entry.delivery', detail: firstLine(text, 50) || undefined, tokens })
      break
    case 'attachment': {
      const { kind, label } = attachmentKind(message.name)
      const path = kind === 'file' ? pathIn(text) : undefined
      // What a tool call set off hangs under it: a nested CLAUDE.md beside a
      // file it touched, the tools a search loaded. Listings that change as MCP
      // servers connect belong to no call.
      const caller = lastTool ? entries[findLast(entries, entry => entry.id === lastTool)] : undefined
      const parent =
        (kind === 'file' && caller?.tool && FILE_TOOLS.has(caller.tool)) || (kind === 'listing' && caller?.tool === 'ToolSearch')
          ? caller.id
          : undefined
      // The same reminder again (a token count, a mode) adds to the one row.
      if (kind === 'reminder') {
        const same = findLast(entries, entry => entry.kind === 'reminder' && entry.label === label && entry.turn === turn && entry.epoch === epoch)
        if (same >= 0) {
          const first = entries[same] as Entry
          entries[same] = { ...first, tokens: first.tokens + tokens, count: (first.count ?? 1) + 1, detail: firstLine(text, 50) || first.detail }
          break
        }
      }
      add({
        id: uuid,
        kind,
        label,
        // A listing's first line only restates its name.
        detail: path || kind === 'listing' ? undefined : firstLine(text, 50) || undefined,
        path,
        tokens,
        parent,
      })
      break
    }
    case 'hook-context': {
      const event = str(row.origin.event)
      add({
        id: uuid,
        kind: 'hook',
        label: `Hook · ${event || 'hook'}`,
        detail: firstLine(text, 50) || undefined,
        tokens,
        parent: TOOL_HOOKS.has(event) ? lastTool : undefined,
      })
      break
    }
    case 'note':
      add({
        id: uuid,
        kind: 'note',
        label: 'entry.plugin',
        labelArg: str(row.origin.name) || 'plugin',
        detail: firstLine(text, 50) || undefined,
        tokens,
      })
      break
    default:
      add({ id: uuid, kind: 'reminder', label: door, detail: firstLine(text, 50) || undefined, tokens })
  }

  return done()
}

/**
 * Ties a subagent to the Agent call that started it, by the description the
 * call gave it (the engine's agent list carries it): the newest call with that
 * description and no subagent yet.
 */
export function bindAgent(log: ContextLog, agentId: string, description: string): ContextLog {
  const bound = new Set(Object.values(log.agents ?? {}))
  const at = findLast(log.entries, entry => entry.kind === 'agent' && entry.detail === description && !bound.has(entry.id))
  if (at < 0) return log

  return { ...log, agents: { ...log.agents, [agentId]: (log.entries[at] as Entry).id } }
}

const PREVIEW_CHARS = 600

function preview(text: string): string {
  const flat = text.replace(/\n{3,}/g, '\n\n').trim()

  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

/** What one model request reported, as `turn.step` resolves it. */
export type StepReport = {
  answer: string
  toolUses: readonly { name: string; input: unknown }[]
  usage: { output_tokens: number } | null
}

/**
 * Sizes the thinking of a step from what the request reported: the tokens it
 * generated, less its visible text and tool calls. Spread over the thinking
 * rows of this turn not yet sized; a row whose words were readable keeps the
 * larger of the two figures.
 */
export function measureThinking(log: ContextLog, step: StepReport): ContextLog {
  if (!step.usage) return log
  const visible =
    estimateTokens(step.answer) +
    step.toolUses.reduce((sum, use) => sum + estimateTokens(use.name + JSON.stringify(use.input ?? {})), 0)
  const thinking = step.usage.output_tokens - visible
  const open = log.entries
    .map((entry, index) => [entry, index] as const)
    .filter(([entry]) => entry.kind === 'thinking' && entry.turn === log.turn && !entry.isMeasured && !entry.isOutside)
  if (open.length === 0 || thinking <= 0) return log
  const share = Math.round(thinking / open.length)
  const entries = [...log.entries]
  for (const [entry, index] of open) {
    entries[index] = { ...entry, tokens: Math.max(entry.tokens, share), isMeasured: true }
  }

  return { ...log, entries }
}

function findLast<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i] as T)) return i

  return -1
}

function cap(log: ContextLog): ContextLog {
  return log.entries.length > MAX_ENTRIES ? { ...log, entries: log.entries.slice(-MAX_ENTRIES) } : log
}

const KINDS = new Set<string>([
  'prompt', 'skill', 'tool', 'agent', 'file', 'listing', 'reminder', 'hook',
  'command', 'delivery', 'note', 'reply', 'thinking', 'compaction', 'loaded',
])

/** A log an earlier version kept, brought to this one's shape. */
export function normalizeLog(log: ContextLog): ContextLog {
  const isCurrent = log.agents && log.entries.every(entry => KINDS.has(entry.kind))
  if (isCurrent) return log

  return {
    ...log,
    agents: log.agents ?? {},
    entries: log.entries.map(entry => (KINDS.has(entry.kind) ? entry : { ...entry, kind: 'reminder' })),
  }
}

/** Rows read back from a resumed conversation, as appends would have made them. */
export function rowsFromMessages(messages: readonly { role: string; content: readonly Block[] }[]): Row[] {
  const rows: Row[] = []
  for (const [index, message] of messages.entries()) {
    const uuid = `resumed:${index}`
    const row = (door: string, content: readonly Block[], extra: Partial<Row['message']> = {}, origin = 'composer'): Row => ({
      door,
      uuid: `${uuid}:${rows.length}`,
      origin: { kind: origin },
      message: { type: message.role, role: message.role, content, ...extra },
    })
    if (message.role === 'assistant') {
      rows.push(row('response', message.content, {}, 'model'))
      continue
    }
    if (message.content.some(block => block.type === 'tool_result')) {
      rows.push(row('tool-result', message.content, {}, 'tool'))
      continue
    }
    // The API form has lost each row's door: read it back from the text's own framing.
    const typed: Block[] = []
    for (const block of message.content) {
      const text = block.type === 'text' ? str(block.text).trimStart() : ''
      if (text.startsWith('<system-reminder>')) {
        rows.push(row('attachment', [block], { isMeta: true }, 'engine'))
      } else if (text.startsWith('<command-name>') || text.startsWith('<command-message>') || text.startsWith('<local-command-')) {
        rows.push(row('command', [block]))
      } else if (text.startsWith('<task-notification>')) {
        rows.push(row('prompt', [block], {}, 'task-notification'))
      } else {
        typed.push(block)
      }
    }
    if (typed.length > 0) rows.push(row('prompt', typed))
  }

  return rows
}


/** Names the startup groups and fills each with what the breakdown lists. */
export function buildStartup(
  breakdown: SessionContextBreakdown,
  sections: readonly StartupItem[],
  contextBlocks: readonly StartupItem[],
  builtinTools: readonly string[],
): Startup {
  const groups: StartupGroup[] = []
  for (const row of breakdown.categories) {
    if (row.kind !== 'used' || row.name === 'Messages') continue
    const group: StartupGroup = {
      key: row.name,
      label: `group.${row.name}`,
      color: row.color,
      tokens: row.tokens,
      items: [],
    }
    switch (row.name) {
      case 'System prompt':
        group.items = [...sections]
        break
      case 'System tools':
        group.names = [...builtinTools]
        break
      case 'MCP tools':
        group.items = mcpServers(breakdown)
        break
      case 'Memory files':
        group.items = breakdown.memoryFiles.map(file => ({
          label: shortPath(file.path),
          detail: file.type,
          path: file.path,
          tokens: file.tokens,
        }))
        break
      case 'Skills':
        group.items = (breakdown.skills?.skillFrontmatter ?? []).map(skill => ({
          label: skill.name,
          detail: skill.pluginName,
          tokens: skill.tokens,
        }))
        break
      case 'Custom agents':
        group.items = breakdown.agents.map(agent => ({ label: agent.agentType, tokens: agent.tokens }))
        break
    }
    group.items.sort((a, b) => b.tokens - a.tokens)
    groups.push(group)
  }
  if (contextBlocks.length > 0) {
    groups.push({
      key: 'context-blocks',
      label: 'group.context-blocks',
      color: 'inactive',
      tokens: contextBlocks.reduce((sum, item) => sum + item.tokens, 0),
      items: [...contextBlocks],
    })
  }
  const deferredRows = breakdown.categories.filter(row => row.kind === 'deferred')
  const deferredTools = breakdown.mcpTools.filter(tool => !tool.isLoaded)

  return {
    groups,
    deferred: {
      count: deferredTools.length,
      tokens: deferredRows.reduce((sum, row) => sum + row.tokens, 0),
    },
    loadedMcp: breakdown.mcpTools.filter(tool => tool.isLoaded).map(tool => tool.name),
  }
}

function mcpServers(breakdown: SessionContextBreakdown): StartupItem[] {
  const servers = new Map<string, { count: number; tokens: number }>()
  for (const tool of breakdown.mcpTools) {
    if (!tool.isLoaded) continue
    const server = servers.get(tool.serverName) ?? { count: 0, tokens: 0 }
    server.count += 1
    server.tokens += tool.tokens
    servers.set(tool.serverName, server)
  }

  return [...servers].map(([name, { count, tokens }]) => ({
    label: name.replace(/^claude\.ai /, ''),
    detail: 'toolsCount',
    detailArg: count,
    tokens,
  }))
}


export function contextBlockItems(blocks: readonly { name: string; text: string }[]): StartupItem[] {
  return blocks
    .filter(block => block.text.length > 0)
    .map(block => ({ label: hasKey(`block.${block.name}`) ? `block.${block.name}` : block.name, tokens: estimateTokens(block.text) }))
}

export function sectionItems(sections: readonly { id: string; text: string }[]): StartupItem[] {
  return sections.map(section => ({ label: section.id, tokens: estimateTokens(section.text) }))
}

/** True for the main loop's system prompt, by the sections it opens with. */
export function isMainPrompt(sections: readonly { id: string }[], tools: readonly string[]): boolean {
  if (sections.length === 0) return false

  return tools.includes('Agent') || sections.some(section => ['doing_tasks', 'lean_body', 'bare'].includes(section.id))
}

/** MCP tools loaded since the last read, as one `loaded` entry. */
export function newlyLoaded(log: ContextLog, before: readonly string[], startup: Startup, breakdown: SessionContextBreakdown): ContextLog {
  const known = new Set(before)
  const fresh = breakdown.mcpTools.filter(tool => tool.isLoaded && !known.has(tool.name))
  if (fresh.length === 0) return log
  const names = fresh.map(tool => toolLabel(tool.name).split('·')[1] ?? tool.name)
  const entry: Entry = {
    id: `loaded:${startup.loadedMcp.length}:${fresh[0]?.name}`,
    kind: 'loaded',
    label: 'entry.loadedTools',
    labelArg: fresh.length,
    detail: names.slice(0, 4).join(', ') + (names.length > 4 ? ' …' : ''),
    tokens: fresh.reduce((sum, tool) => sum + tool.tokens, 0),
    turn: log.turn,
    epoch: log.epoch,
    parent: log.entries.findLast(one => one.tool === 'ToolSearch' && one.turn === log.turn)?.id,
  }

  return cap({ ...log, entries: [...log.entries, entry] })
}
