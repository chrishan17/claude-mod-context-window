import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextLog, Fill, PaneView, Startup, StartupItem } from '../types'
import {
  EMPTY_LOG,
  bindAgent,
  measureThinking,
  normalizeLog,
  buildStartup,
  contextBlockItems,
  isMainPrompt,
  newlyLoaded,
  reduceRow,
  rowsFromMessages,
  sectionItems,
} from './classify'
import type { Block } from './classify'
import { pickLang, t } from './i18n'
import type { Lang } from './i18n'
import { drawPane } from './view'

const PANE = 'context-window'
const TITLE = 'Context'

const log = atom({ plugin: 'context-window', key: 'log' } as const, EMPTY_LOG as ContextLog)
const startup = atom({ plugin: 'context-window', key: 'startup' } as const, null as Startup | null)
const sections = atom({ plugin: 'context-window', key: 'sections' } as const, [] as StartupItem[])
const contextBlocks = atom({ plugin: 'context-window', key: 'contextBlocks' } as const, [] as StartupItem[])
const tools = atom({ plugin: 'context-window', key: 'tools' } as const, [] as string[])
const fill = atom({ plugin: 'context-window', key: 'fill' } as const, null as Fill | null)
const view = atom({ plugin: 'context-window', key: 'view' } as const, 'timeline' as PaneView)
const toggled = atom({ plugin: 'context-window', key: 'toggled' } as const, [] as string[])
const asked = atom({ plugin: 'context-window', key: 'asked' } as const, false)
const lang = atom({ plugin: 'context-window', key: 'lang' } as const, 'zh' as Lang)

/** The sidebar's width beside a fullscreen transcript. */
const DOCK_COLUMNS = 64

/**
 * Reads the window's fill; with `withBreakdown`, also what the session carried
 * from the start (estimated locally, no API call) and any tools loaded since.
 */
async function refresh($: EngineInterface, withBreakdown = true): Promise<void> {
  const usage = await $.session.usage(withBreakdown ? { breakdown: 'summary' } : undefined)
  const { tokens, window, percent, breakdown } = usage.context
  await update($, fill, previous => ({ tokens, window, percent, model: breakdown?.model ?? previous?.model }))
  if (!breakdown) return

  // The system prompt's sections and the built-in tools, asked of the engine
  // once if no main request has been composed through this plugin yet.
  try {
    const known = await read($, sections)
    const knownTools = await read($, tools)
    if (known.length === 0 || knownTools.length === 0) {
      const listed = await $.tool.list()
      const builtin = listed.filter(tool => !tool.mcp).map(tool => tool.name)
      if (knownTools.length === 0) await update($, tools, () => builtin)
      if (known.length === 0) {
        const composed = await $.prompt.compose({
          model: breakdown.model,
          promptModel: breakdown.model,
          surfaces: await $.session.surfaces(),
          tools: listed.map(tool => tool.name),
          outputStyle: null,
          traits: [],
        })
        await update($, sections, () => sectionItems(composed.sections))
      }
    }
  } catch {
    // Names only: the groups still draw with their sizes without them.
  }
  const before = await read($, startup)
  const next = buildStartup(breakdown, await read($, sections), await read($, contextBlocks), await read($, tools))
  if (before) await update($, log, current => newlyLoaded(normalizeLog(current), before.loadedMcp, next, breakdown))
  await update($, startup, () => next)
}

/** A resumed conversation's rows were loaded, not appended: read them back once. */
async function seedFromTranscript($: EngineInterface): Promise<void> {
  if ((await read($, log)).entries.length > 0) return
  const messages = await $.session.messages({ as: 'api' })
  if (!Array.isArray(messages) || messages.length === 0) return
  const rows = rowsFromMessages(messages as { role: string; content: Block[] }[])
  await update($, log, current => (current.entries.length > 0 ? current : rows.reduce(reduceRow, current)))
}

async function toggle($: EngineInterface, key: string): Promise<void> {
  await update($, toggled, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key]))
}

/**
 * The pane's language: the `language` option, or with `auto` Claude Code's own
 * `language` setting, then the system locale.
 */
async function settleLang($: EngineInterface, option: unknown): Promise<Lang> {
  let setting: string | undefined
  try {
    const row = (await $.config.list()).find(one => one.key === 'language')
    setting = typeof row?.value === 'string' ? row.value : undefined
  } catch {
    // No settings menu here: fall back to the locale.
  }
  let locale: string | undefined
  try {
    locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  } catch {
    // No environment to read: English.
  }
  const picked = pickLang(typeof option === 'string' ? option : undefined, setting, locale)
  await update($, lang, () => picked)

  return picked
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const language = await settleLang($, options.language)
    await $.command.register({
      name: 'context-window',
      description: t(language, 'command.description'),
    })
    // Unasked, the pane belongs in the sidebar only: ui.render closes it again
    // where the layout would put it above the prompt instead.
    void $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
    await seedFromTranscript($)
    await refresh($)

    return result
  })

  on('command.run', { command: 'context-window' }, async ($, e) => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      await update($, asked, () => false)
      await $.ui.close({ id: PANE })

      // A toast, not a transcript line: nothing of this command reaches the model.
      return {}
    }
    await update($, asked, () => true)
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
    const language = await read($, lang)
    if (!opened.isPlaced) $.ui.toast(t(language, 'toast.narrow'))
    else if (!e.presentation.isFullscreen) {
      $.ui.toast(t(language, 'toast.noSidebar'))
    }

    return {}
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, asked, () => false)

    return result
  })

  // Every row the main conversation keeps passes here once: log it after it is stored.
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId && !(await read($, log)).agents?.[e.agentId]) {
        // A subagent's first row: find the Agent call that started it.
        const info = (await $.agent.list()).find(agent => agent.id === e.agentId)
        if (!info) return result
        await update($, log, current => bindAgent(normalizeLog(current), info.id, info.description))
      }
      await update($, log, current => reduceRow(normalizeLog(current), e))
    } catch {
      // A row the log cannot read must never fail the append.
    }

    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (isMainPrompt(result.sections, e.tools) || (await read($, sections)).length === 0) {
      const items = sectionItems(result.sections)
      const builtin = e.tools.filter(name => !name.startsWith('mcp__'))
      const known = await read($, sections)
      if (JSON.stringify(known) !== JSON.stringify(items)) await update($, sections, () => items)
      const knownTools = await read($, tools)
      if (knownTools.join() !== builtin.join()) await update($, tools, () => builtin)
    }

    return result
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    await update($, contextBlocks, () => contextBlockItems(result.blocks))

    return result
  })

  // Each model request of the main loop moves the fill: read it as it ends.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (!e.agentId) {
      await update($, log, current => measureThinking(normalizeLog(current), response))
      await refresh($, false)
    }

    return response
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await refresh($)

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      await update($, log, () => EMPTY_LOG)
      await update($, toggled, () => [])
      await refresh($)
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const isInline = e.props.placement === 'inline'
    if (isInline && !(await read($, asked))) {
      // Opened at session start on a layout with no sidebar: step aside.
      void $.clock.after(0, () => void $.ui.close({ id: PANE }))
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>context-window: /context-window to open</Text>
    }
    const current = normalizeLog(await read($, log))

    return drawPane(
      $.ui.resolve(e),
      {
        fill: await read($, fill),
        startup: await read($, startup),
        entries: current.entries,
        epoch: current.epoch,
        view: await read($, view),
        toggled: await read($, toggled),
        lang: await read($, lang),
        columns: Math.max(24, e.props.bodyColumns),
        isInline,
      },
      {
        toggle: key => void toggle($, key),
        setView: next => void update($, view, () => next),
        refresh: () => void refresh($),
      },
    )
  })
}
