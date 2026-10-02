import { expect, test } from 'claude-code/testing'

import { EMPTY_LOG, bindAgent, compactLog, measureThinking, reduceRow, rowsFromMessages, toolLabel } from '../hooks/classify'
import type { Row } from '../hooks/classify'

const prompt = (uuid: string, text: string): Row => ({
  door: 'prompt',
  uuid,
  origin: { kind: 'composer' },
  message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
})

const toolUse = (uuid: string, id: string, name: string, input: Record<string, unknown>, agentId?: string): Row => ({
  door: 'response',
  uuid,
  origin: { kind: 'model', model: 'claude-opus-5-5' },
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  agentId,
})

const toolResult = (uuid: string, id: string, tool: string, content: string, isError = false): Row => ({
  door: 'tool-result',
  uuid,
  origin: { kind: 'tool', tool },
  message: {
    type: 'user',
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
  },
})

const attachment = (uuid: string, name: string, text: string): Row => ({
  door: 'attachment',
  uuid,
  origin: { kind: 'engine' },
  message: { type: 'attachment', name, role: 'user', isMeta: true, content: [{ type: 'text', text }] },
})

const fold = (rows: Row[]) => rows.reduce(reduceRow, EMPTY_LOG)

test('a prompt opens a turn and a file tool keeps its path', () => {
  const log = fold([
    prompt('p1', 'Fix the bug in register.tsx'),
    toolUse('r1', 'tu1', 'Read', { file_path: '/Users/x/dev/mod/hooks/register.tsx' }),
    toolResult('t1', 'tu1', 'Read', 'x'.repeat(3600)),
  ])

  expect(log.turn).toBe(1)
  expect(log.entries[1]).toMatchObject({
    kind: 'tool',
    label: 'Read',
    path: '/Users/x/dev/mod/hooks/register.tsx',
    turn: 1,
  })
  expect(log.entries[1]?.isPending).toBeUndefined()
  expect(log.entries[1]?.tokens).toBeGreaterThan(1000)
})

test('a loaded skill is its own entry and the calls after it hang under it', () => {
  const log = fold([
    prompt('p1', 'make a mod'),
    toolUse('r1', 'sk1', 'Skill', { skill: 'plugin-authoring' }),
    toolResult('t1', 'sk1', 'Skill', 'Launching skill: plugin-authoring'),
    {
      door: 'tool-message',
      uuid: 'm1',
      origin: { kind: 'tool', tool: 'Skill' },
      message: {
        type: 'user',
        role: 'user',
        isMeta: true,
        content: [{ type: 'text', text: `Base directory for this skill: /x/skills/plugin-authoring\n\n${'body '.repeat(800)}` }],
      },
    },
    toolUse('r2', 'tu2', 'Bash', { command: 'claude plugin validate .' }),
    toolResult('t2', 'tu2', 'Bash', 'ok'),
  ])
  const skill = log.entries.find(entry => entry.kind === 'skill')
  const bash = log.entries.find(entry => entry.tool === 'Bash')

  expect(skill).toMatchObject({ id: 'sk1', label: 'plugin-authoring', path: '/x/skills/plugin-authoring/SKILL.md' })
  expect(skill?.tokens).toBeGreaterThan(500)
  expect(bash?.parent).toBe('sk1')
})

test('the skill description listing is a listing, not a loaded skill', () => {
  const log = fold([
    attachment('a1', 'skill_listing', '<system-reminder>\nThe following skills are available\n</system-reminder>'),
    attachment('a2', 'environment', '# Environment\nYou have been invoked in...'),
    {
      door: 'notice',
      uuid: 'n1',
      origin: { kind: 'engine' },
      message: { type: 'system', content: [{ type: 'text', text: 'Hooks loaded' }] },
    },
  ])

  expect(log.entries.map(entry => [entry.kind, entry.label])).toEqual([
    ['listing', 'att.skill_listing'],
    ['reminder', 'att.environment'],
  ])
})

test('a nested CLAUDE.md found beside a read file hangs under that read', () => {
  const log = fold([
    prompt('p1', 'read it'),
    toolUse('r1', 'tu1', 'Read', { file_path: '/x/pkg/src/a.ts' }),
    toolResult('t1', 'tu1', 'Read', 'code'),
    attachment('a1', 'nested_memory', 'Contents of /x/pkg/CLAUDE.md:\n\nrules here'),
    toolUse('r2', 'tu2', 'Bash', { command: 'ls' }),
    attachment('a2', 'todo_reminder', 'Remember the todo list'),
  ])
  const nested = log.entries.find(entry => entry.kind === 'file')
  const todo = log.entries.find(entry => entry.kind === 'reminder')

  expect(nested).toMatchObject({ label: 'att.nested_memory', path: '/x/pkg/CLAUDE.md', parent: 'tu1' })
  expect(todo?.parent).toBeUndefined()
})

test('listings belong to a search only, and repeated reminders fold into one row', () => {
  const log = fold([
    prompt('p1', 'go'),
    toolUse('r1', 'tu1', 'Read', { file_path: '/x/a.ts' }),
    toolResult('t1', 'tu1', 'Read', 'code'),
    attachment('a1', 'deferred_tools_delta', 'The following deferred tools are now available'),
    toolUse('r2', 'ts1', 'ToolSearch', { query: 'select:Monitor' }),
    toolResult('t2', 'ts1', 'ToolSearch', 'loaded'),
    attachment('a2', 'deferred_tools_delta', 'Monitor is now loaded'),
    attachment('a3', 'total_tokens_reminder', '15000000 tokens left'),
    attachment('a4', 'total_tokens_reminder', '14900000 tokens left'),
  ])
  const listings = log.entries.filter(entry => entry.kind === 'listing')
  const reminders = log.entries.filter(entry => entry.kind === 'reminder')

  expect(listings.map(entry => entry.parent)).toEqual([undefined, 'ts1'])
  expect(reminders).toHaveLength(1)
  expect(reminders[0]).toMatchObject({ count: 2, detail: '14900000 tokens left' })
})

test("a subagent's hand-back hangs under its Agent call", () => {
  const log = fold([
    prompt('p1', 'explore'),
    toolUse('r1', 'ag1', 'Agent', { subagent_type: 'Explore', description: 'Find it' }),
    {
      door: 'prompt',
      uuid: 'h1',
      origin: { kind: 'composer' },
      message: {
        type: 'user',
        role: 'user',
        isMeta: true,
        content: [{ type: 'text', text: 'Another Claude session sent a message:\n[Subagent hand-back] Found it in classify.ts' }],
      },
    },
  ])

  expect(log.turn).toBe(1)
  expect(log.entries.find(entry => entry.id === 'h1')).toMatchObject({ kind: 'delivery', label: 'entry.handBack', parent: 'ag1' })
})

test("a subagent's steps hang under its Agent call, outside this window", () => {
  let log = fold([
    prompt('p1', 'explore'),
    toolUse('r1', 'ag1', 'Agent', { subagent_type: 'Explore', description: 'Find the hooks', prompt: '...' }),
  ])
  log = bindAgent(log, 'agent-1', 'Find the hooks')
  log = reduceRow(log, toolUse('s1', 'sub1', 'Grep', { pattern: 'on\\(' }, 'agent-1'))
  log = reduceRow(log, toolResult('t1', 'ag1', 'Agent', 'The hooks are in register.tsx'))
  const step = log.entries.find(entry => entry.id === 'sub1')

  expect(log.entries.find(entry => entry.id === 'ag1')).toMatchObject({ kind: 'agent', label: 'Explore', detail: 'Find the hooks' })
  expect(step).toMatchObject({ parent: 'ag1', isOutside: true, label: 'Grep' })
})

test('a compaction boundary bumps the epoch though it has no role', () => {
  const log = fold([
    prompt('p1', 'first'),
    {
      door: 'compaction',
      uuid: 'c1',
      origin: { kind: 'engine' },
      message: { type: 'system', name: 'compact_boundary', content: [{ type: 'text', text: 'Conversation compacted' }] },
    },
    {
      door: 'compaction',
      uuid: 'c2',
      origin: { kind: 'engine' },
      message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: 'summary '.repeat(200) }] },
    },
  ])

  expect(log.epoch).toBe(1)
  expect(log.entries.filter(entry => entry.epoch === 1)).toHaveLength(1)
  expect(log.entries[1]).toMatchObject({ kind: 'compaction', label: 'entry.compactSummary' })
})

test('a compaction seen only by its hook still starts a new window, once', () => {
  const before = fold([prompt('p1', 'first'), toolUse('r1', 'tu1', 'Bash', { command: 'ls' }), toolResult('t1', 'tu1', 'Bash', 'a.ts')])
  const summary = [{ role: 'user', text: 'summary '.repeat(200), toolUses: [] }] as const
  let log = compactLog(before, 'compact:1', summary)

  expect(log.epoch).toBe(1)
  expect(log.entries.filter(entry => entry.epoch === 1)).toEqual([expect.objectContaining({ kind: 'compaction', label: 'entry.compactSummary' })])
  expect(log.entries.filter(entry => entry.epoch === 1)[0]?.tokens).toBeGreaterThan(100)

  // Should the engine also append the boundary, the same compaction is not counted twice.
  log = reduceRow(log, {
    door: 'compaction',
    uuid: 'c1',
    origin: { kind: 'engine' },
    message: { type: 'system', name: 'compact_boundary', content: [{ type: 'text', text: 'Conversation compacted' }] },
  })
  expect(log.epoch).toBe(1)
  expect(compactLog(log, 'compact:2', summary).epoch).toBe(1)

  log = reduceRow(log, prompt('p2', 'next'))
  expect(compactLog(log, 'compact:2', summary).epoch).toBe(2)
})

test('a resumed transcript keeps reminders and commands out of the turns', () => {
  const rows = rowsFromMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>\nAs you answer, use this context\n</system-reminder>' },
        { type: 'text', text: '把面板改成时间线' },
      ],
    },
    { role: 'user', content: [{ type: 'text', text: '<command-name>/compact</command-name>' }] },
    { role: 'user', content: [{ type: 'text', text: '<system-reminder>The user has not heard from you</system-reminder>' }] },
  ])
  const log = rows.reduce(reduceRow, EMPTY_LOG)

  expect(log.turn).toBe(2)
  expect(log.entries.map(entry => entry.kind)).toEqual(['reminder', 'prompt', 'command', 'reminder'])
  expect(log.entries[1]?.label).toBe('把面板改成时间线')
  expect(log.entries[2]?.label).toBe('/compact')
})

test('thinking keeps its words when readable and is sized from usage when not', () => {
  const think = (uuid: string, thinking: string): Row => ({
    door: 'response',
    uuid,
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking, signature: 'x'.repeat(2000) }] },
  })
  let log = fold([prompt('p1', 'go'), think('r1', ''), think('r2', 'Plan: read the file first, then patch the parser.')])
  const [sealed, readable] = log.entries.filter(entry => entry.kind === 'thinking')

  expect(sealed).toMatchObject({ detail: 'entry.thinkingSealed', tokens: 0 })
  expect(readable).toMatchObject({ detail: 'Plan: read the file first, then patch the parser.' })
  expect(readable?.preview).toContain('patch the parser')

  log = measureThinking(log, { answer: '', toolUses: [], usage: { output_tokens: 900 } })
  const sized = log.entries.filter(entry => entry.kind === 'thinking')

  expect(sized.map(entry => entry.tokens)).toEqual([450, 450])
  expect(sized.every(entry => entry.isMeasured)).toBe(true)
})

test('MCP tool names read as server and tool', () => {
  expect(toolLabel('mcp__claude_ai_Datadog__search_datadog_logs')).toBe('Datadog·search_datadog_logs')
  expect(toolLabel('Bash')).toBe('Bash')
})
