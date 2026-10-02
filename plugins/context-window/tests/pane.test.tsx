import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const USAGE: SessionUsage = {
  startedAt: 0,
  rateLimits: [],
  context: {
    tokens: 40_000,
    window: 200_000,
    percent: 20,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 3_100, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'MCP tools', tokens: 9_000, color: 'permission', isDeferred: false, kind: 'used' },
        { name: 'Memory files', tokens: 1_200, color: 'claude', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 26_700, color: 'suggestion', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 127_000, color: 'inactive', isDeferred: false, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
      ],
      totalTokens: 40_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'auto',
      percentage: 20,
      gridRows: [],
      model: 'claude-opus-5-5',
      memoryFiles: [{ path: '/Users/x/.claude/CLAUDE.md', type: 'User', tokens: 1_200 }],
      mcpTools: [
        { name: 'mcp__claude_ai_Datadog__search_logs', serverName: 'claude.ai Datadog', tokens: 9_000, isLoaded: true },
        { name: 'mcp__claude_ai_Vercel__deploy', serverName: 'claude.ai Vercel', tokens: 800, isLoaded: false },
      ],
      agents: [],
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
}

const PANE = {
  component: 'Pane',
  requestId: 'context-window',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const MESSAGES = [
  { role: 'user', content: [{ type: 'text', text: '帮我修一下 register.tsx 里的 bug' }] },
  {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'FAIL '.repeat(5000), is_error: true }],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'The test fails because of a typo.' }] },
] as const

/** Stands for the engine beneath the plugin: a resumed conversation of four rows. */
function engine(on: On, messages: readonly unknown[] = MESSAGES) {
  mock.clock(on)
  mock.env(on, {})
  on('session.usage', () => ({ value: USAGE }))
  on('session.messages', () => ({ value: messages as never }))
  on('command.register', () => ({ value: { command: 'context-window' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
      { id: 'doing_tasks', text: 'Do the task.', scope: 'shared' },
    ],
  }))
  on('tool.list', () => ({
    value: [
      { name: 'Bash', description: '', mcp: false },
      { name: 'Read', description: '', mcp: false },
      { name: 'mcp__claude_ai_Datadog__search_logs', description: '', mcp: true },
    ],
  }))
}

const START = { cwd: '/x', surface: 'terminal', isInteractive: true } as const

test('the pane lists what entered the context, by turn and by category', { options: { language: 'zh' } }, async ($, on) => {
  engine(on)
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-window', surface, ...PANE })
    await ui.press({ key: 'refresh' })

    expect(await ui.find({ type: 'Text', text: /启动时载入/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MCP 工具/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /帮我修一下 register\.tsx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /The test fails because/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗ ' })).toBeDefined()

    await ui.press({ key: 'start:MCP tools' })
    expect(await ui.find({ type: 'Text', text: /Datadog/ })).toBeDefined()
    await ui.press({ key: 'start:System prompt' })
    expect(await ui.find({ type: 'Text', text: /doing_tasks/ })).toBeDefined()
    await ui.press({ key: 'start:Memory files' })
    const link = await ui.find({ type: 'Markdown' })
    expect(link?.props.text).toBe('[…/.claude/CLAUDE.md](file:///Users/x/.claude/CLAUDE.md)')
    await ui.press({ key: 'start:Memory files' })

    await ui.press({ key: 'view:category' })
    expect(await ui.find({ type: 'Text', text: /对话消息/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /工具调用/ })).toBeDefined()
    await ui.press({ key: 'view:timeline' })
    await ui.press({ key: 'start:MCP tools' })
    await ui.press({ key: 'start:System prompt' })
    await ui.unmount()
  }
})

test('every view draws what the window holds, on every surface that docks', { options: { language: 'zh' } }, async ($, on) => {
  engine(on)
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-window', surface, ...PANE })
    await ui.press({ key: 'refresh' })

    await ui.press({ key: 'view:top' })
    expect(await ui.find({ type: 'Text', text: /占用排行/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*1 {2}(内置工具|MCP 工具)$/ })).toBeDefined()

    await ui.press({ key: 'view:files' })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('file:///Users/x/.claude/CLAUDE.md')
    expect(await ui.find({ type: 'Text', text: /记忆/ })).toBeDefined()

    await ui.press({ key: 'view:origin' })
    expect(await ui.find({ type: 'Text', text: /谁放进来的/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /工具结果/ })).toBeDefined()

    await ui.press({ key: 'view:growth' })
    expect(await ui.find({ type: 'Text', text: /每轮增长/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 1 帮我修一下/ })).toBeDefined()

    await ui.press({ key: 'view:timeline' })
    await ui.unmount()
  }
})

test('a fresh session says nothing has entered yet', { options: { language: 'zh' } }, async ($, on) => {
  engine(on, [])
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'context-window', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /还没有内容加入/ })).toBeDefined()
  await ui.unmount()
})

test('the pane speaks English when asked', { options: { language: 'en' } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'context-window', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /Loaded at startup/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Skill descriptions$|^Memory files$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Timeline/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /启动时载入/ })).toBeUndefined()
  await ui.unmount()
})
