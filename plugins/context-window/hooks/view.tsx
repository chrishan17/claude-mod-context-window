import type { Elements, RenderSurface } from 'claude-code'

import type { Entry, EntryKind, Fill, PaneView, Startup, StartupGroup, StartupItem } from '../types'
import { shortPath } from './classify'
import { hasKey, t } from './i18n'
import type { Lang } from './i18n'

type Ui = Elements[RenderSurface]

type Style = { glyph: string; color: string; isQuiet?: boolean }

/** How each kind is drawn: its glyph, its colour, and whether it is quiet. */
export const KINDS: Record<EntryKind, Style> = {
  prompt: { glyph: '❯', color: 'suggestion' },
  skill: { glyph: '✦', color: 'claude' },
  tool: { glyph: '◆', color: 'success' },
  agent: { glyph: '❖', color: 'permission' },
  file: { glyph: '❐', color: 'warning' },
  listing: { glyph: '☰', color: 'warning' },
  reminder: { glyph: '+', color: 'warning' },
  hook: { glyph: '↳', color: 'warning' },
  command: { glyph: '/', color: 'ide' },
  delivery: { glyph: '»', color: 'autoAccept' },
  note: { glyph: '◇', color: 'autoAccept' },
  loaded: { glyph: '+', color: 'autoAccept' },
  reply: { glyph: '●', color: 'claude', isQuiet: true },
  thinking: { glyph: '✻', color: 'inactive', isQuiet: true },
  compaction: { glyph: '≡', color: 'inactive' },
}

/** The views, in switcher order, with their hotkeys. */
const VIEWS: readonly (readonly [PaneView, string])[] = [
  ['timeline', '1'],
  ['category', '2'],
  ['top', '3'],
  ['files', '4'],
  ['origin', '5'],
  ['growth', '6'],
]

/** The category view's two session sections, as the docs split them. */
const ON_DEMAND: EntryKind[] = ['skill', 'file', 'listing', 'loaded']
const CONVERSATION: EntryKind[] = ['tool', 'agent', 'prompt', 'reminder', 'hook', 'reply', 'thinking', 'command', 'delivery', 'note', 'compaction']

/** What the engine attaches on its own; at a turn's start these fold together. */
const INJECTED: EntryKind[] = ['listing', 'reminder', 'file', 'hook']

/** Turns drawn one by one; older ones fold into one row. */
const RECENT_TURNS = 20
/** Turns open by default, newest first. */
const OPEN_TURNS = 2
/** Items listed under an open group before "N more". */
const TOP_ITEMS = 8
/** The right-hand columns: share and tokens. */
const SHARE_WIDTH = 5
const TOKENS_WIDTH = 7

export type PaneData = {
  lang: Lang
  fill: Fill | null
  startup: Startup | null
  entries: Entry[]
  epoch: number
  view: PaneView
  toggled: readonly string[]
  columns: number
  /** Drawn above the prompt rather than docked in the sidebar. */
  isInline?: boolean
}

export type PaneActions = {
  toggle: (key: string) => void
  setView: (view: PaneView) => void
  refresh: () => void
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}k`

  return String(Math.round(n))
}

function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
}

function sizeColor(tokens: number): string | undefined {
  if (tokens >= 20_000) return 'error'
  if (tokens >= 5_000) return 'warning'

  return undefined
}

function fillColor(percent: number): string {
  if (percent >= 85) return 'error'
  if (percent >= 60) return 'warning'

  return 'success'
}

function sum(list: readonly { tokens: number }[]): number {
  return list.reduce((total, one) => total + one.tokens, 0)
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** Cells a string takes in a terminal: CJK and full-width characters take two. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += WIDE.test(char) ? 2 : 1

  return width
}

/** A file path as a `file:` URL, each segment encoded. */
export function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

/** A markdown link to a file, its label the path's last two segments. */
export function fileLink(path: string): string {
  const label = shortPath(path).replace(/([\\[\]()*_`])/g, '\\$1')

  return `[${label}](${fileUrl(path)})`
}

/** The tree drawing before a child: the guides of its ancestors, then its own branch. */
function branch(guides: string, isLast: boolean): string {
  return `${guides}${isLast ? '└─' : '├─'}`
}

function guidesFor(guides: string, isLast: boolean): string {
  return `${guides}${isLast ? '  ' : '│ '}`
}

type RowProps = {
  guide?: string
  toggleKey?: string
  isOpenNow?: boolean
  glyph: string
  color: string
  label: string
  isBold?: boolean
  detail?: string
  path?: string
  badge?: string
  badgeColor?: string
  share?: string
  tokens?: number
  isQuiet?: boolean
  isError?: boolean
}

export function drawPane(ui: Ui, data: PaneData, act: PaneActions) {
  const { Box, Text, Button, Markdown } = ui
  const { lang } = data
  const tr = (text: string | undefined, arg?: string | number) =>
    text === undefined ? undefined : hasKey(text) ? t(lang, text, arg ?? '') : text
  const isOpen = (key: string, byDefault: boolean) => byDefault !== data.toggled.includes(key)
  const live = data.entries.filter(entry => entry.epoch === data.epoch)
  const inWindow = live.filter(entry => !entry.isOutside)
  const groups = data.startup?.groups ?? []
  const startupTokens = sum(groups)
  const hasShare = data.view === 'top' || data.view === 'category' || data.view === 'origin'

  /**
   * One row on a fixed grid: guides, toggle, glyph | name, detail or file link
   * (truncated) | badge | share | tokens, the last two right-aligned columns.
   */
  const row = (props: RowProps) => {
    const color = props.isError ? 'error' : props.color
    // A detail that only restates the name ("Environment  Environment") is dropped.
    const detail = props.detail && props.detail.toLowerCase() !== props.label.toLowerCase() ? props.detail : undefined
    const tokenColor = props.tokens === undefined || props.isQuiet ? undefined : sizeColor(props.tokens)

    return (
      <Box flexDirection="row">
        <Box flexShrink={0}>
          {props.guide ? <Text dimColor>{props.guide}</Text> : null}
          {props.toggleKey ? (
            <Button
              key={props.toggleKey}
              plain
              dimColor
              label={props.isOpenNow ? '▾' : '▸'}
              onPress={() => act.toggle(props.toggleKey as string)}
            />
          ) : (
            <Text> </Text>
          )}
          <Text color={color}>{` ${props.isError ? '✗' : props.glyph} `}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row">
          <Box flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">
              <Text bold={props.isBold} dimColor={props.isQuiet}>
                {props.label}
              </Text>
              {detail && !props.path ? <Text dimColor>{`  ${detail}`}</Text> : null}
            </Text>
          </Box>
          {props.path ? (
            <Box flexShrink={0} marginLeft={2}>
              <Markdown text={fileLink(props.path)} dimColor />
            </Box>
          ) : null}
        </Box>
        {props.badge ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text color={props.badgeColor} dimColor={!props.badgeColor}>
              {props.badge}
            </Text>
          </Box>
        ) : null}
        {hasShare ? (
          <Box flexShrink={0} width={SHARE_WIDTH} justifyContent="flex-end">
            <Text dimColor>{props.share ?? ''}</Text>
          </Box>
        ) : null}
        <Box flexShrink={0} width={TOKENS_WIDTH} justifyContent="flex-end">
          <Text color={tokenColor} dimColor={!tokenColor}>
            {props.tokens === undefined ? '' : formatTokens(props.tokens)}
          </Text>
        </Box>
      </Box>
    )
  }

  /** A section heading: title, dim note, a rule to the edge, its total. */
  const heading = (title: string, tokens?: number, note?: string) => {
    const used = displayWidth(title) + (note ? displayWidth(note) + 2 : 0)
    const rule = Math.max(2, data.columns - used - TOKENS_WIDTH - (hasShare ? SHARE_WIDTH : 0) - 2)

    return (
      <Box flexDirection="row" marginTop={1}>
        <Box flexShrink={0}>
          <Text bold>{title}</Text>
          {note ? <Text dimColor>{`  ${note}`}</Text> : null}
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={1}>
          <Text dimColor wrap="truncate">
            {'─'.repeat(rule)}
          </Text>
        </Box>
        {hasShare ? <Box flexShrink={0} width={SHARE_WIDTH} /> : null}
        <Box flexShrink={0} width={TOKENS_WIDTH} justifyContent="flex-end">
          <Text bold>{tokens === undefined ? '' : formatTokens(tokens)}</Text>
        </Box>
      </Box>
    )
  }

  /** Items under an open group, each on a branch, the first few then "N more". */
  const itemRows = (items: readonly StartupItem[], guides: string, key: string, total?: number) => {
    const shown = isOpen(`${key}:all`, false) ? items : items.slice(0, TOP_ITEMS)
    const more = items.length - shown.length

    return (
      <Box flexDirection="column">
        {shown.map((item, index) =>
          row({
            guide: branch(guides, index === shown.length - 1 && more === 0),
            glyph: '·',
            color: 'inactive',
            label: tr(item.label) ?? '',
            detail: tr(item.detail, item.detailArg),
            path: item.path,
            share: total ? `${Math.round((item.tokens / total) * 100)}%` : undefined,
            tokens: item.tokens > 0 ? item.tokens : undefined,
          }),
        )}
        {more > 0 && (
          <Box flexDirection="row">
            <Text dimColor>{`${branch(guides, true)}   `}</Text>
            <Button key={`${key}:all`} plain dimColor label={t(lang, 'more', more)} onPress={() => act.toggle(`${key}:all`)} />
          </Box>
        )}
      </Box>
    )
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  /** The entries under each parent, in the order they came. */
  const children = new Map<string, Entry[]>()
  const ids = new Set(live.map(entry => entry.id))
  for (const entry of live) {
    if (!entry.parent || !ids.has(entry.parent)) continue
    children.set(entry.parent, [...(children.get(entry.parent) ?? []), entry])
  }
  const subtree = (entry: Entry): Entry[] => [entry, ...(children.get(entry.id) ?? []).flatMap(subtree)]

  /** One entry on its branch and, while open, its children and preview. */
  const node = (entry: Entry, guides: string, isLast: boolean) => {
    const style = KINDS[entry.kind]
    const kids = children.get(entry.id) ?? []
    const key = `node:${entry.id}`
    // An Agent's own steps live in its window, a preview is long: shut until asked.
    const open = isOpen(key, entry.kind !== 'agent' && kids.length > 0)
    const canOpen = kids.length > 0 || !!entry.preview
    const inside = subtree(entry).filter(one => !one.isOutside)
    const outside = kids.filter(one => one.isOutside)
    let badge: string | undefined
    let badgeColor: string | undefined
    if (entry.isPending) {
      badge = t(lang, 'badge.running')
      badgeColor = 'warning'
    } else if (entry.isOutside) {
      badge = t(lang, 'badge.outside')
    } else if (entry.kind === 'agent') {
      badge = outside.length > 0 ? t(lang, 'badge.resultSteps', outside.length) : t(lang, 'badge.resultOnly')
    } else if (entry.count && entry.count > 1) {
      badge = `×${entry.count}`
    } else if (entry.isMeasured) {
      badge = t(lang, 'badge.measured')
    } else if (kids.length > 0 && !open) {
      badge = `+${kids.length} · ${formatTokens(sum(inside))}`
    }
    const childGuides = guidesFor(guides, isLast)
    const visibleKids = open ? kids : []

    return (
      <Box flexDirection="column">
        {row({
          guide: branch(guides, isLast),
          toggleKey: canOpen ? key : undefined,
          isOpenNow: open,
          glyph: style.glyph,
          color: entry.isOutside ? 'inactive' : style.color,
          label: tr(entry.label, entry.labelArg) ?? '',
          isBold: entry.kind === 'skill' || entry.kind === 'agent',
          detail: tr(entry.detail, entry.detailArg),
          path: entry.path,
          badge,
          badgeColor,
          tokens: entry.tokens,
          isQuiet: entry.isOutside || style.isQuiet,
          isError: entry.isError,
        })}
        {open && entry.preview && (
          <Box flexDirection="row">
            <Text dimColor>{`${childGuides}   `}</Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0} marginBottom={1}>
              <Text dimColor wrap="wrap">
                {entry.preview}
              </Text>
            </Box>
          </Box>
        )}
        {visibleKids.map((kid, index) => node(kid, childGuides, index === visibleKids.length - 1))}
      </Box>
    )
  }

  /** The rows attached with a prompt, folded into one branch. */
  const injectedGroup = (list: Entry[], key: string, guides: string, isLast: boolean) => {
    const open = isOpen(key, list.length <= 4)
    const counts = INJECTED.map(kind => [kind, list.filter(entry => entry.kind === kind).length] as const)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${KINDS[kind].glyph}${n}`)
      .join(' ')
    const childGuides = guidesFor(guides, isLast)

    return (
      <Box flexDirection="column">
        {row({
          guide: branch(guides, isLast),
          toggleKey: key,
          isOpenNow: open,
          glyph: '+',
          color: 'warning',
          label: t(lang, 'injectedGroup', list.length),
          detail: counts,
          tokens: sum(list),
        })}
        {open && list.map((entry, index) => node(entry, childGuides, index === list.length - 1))}
      </Box>
    )
  }

  const startupGroup = (group: StartupGroup, isLast: boolean) => {
    const key = `start:${group.key}`
    const open = isOpen(key, false)
    const count = group.names?.length ?? group.items.length
    const childGuides = guidesFor('', isLast)

    return (
      <Box flexDirection="column">
        {row({
          guide: branch('', isLast),
          toggleKey: count > 0 ? key : undefined,
          isOpenNow: open,
          glyph: '■',
          color: group.color,
          label: tr(group.label) ?? group.key,
          detail: count > 0 ? `${count}` : undefined,
          tokens: group.tokens,
        })}
        {open && group.names && (
          <Box flexDirection="row">
            <Text dimColor>{`${childGuides}   `}</Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text dimColor wrap="wrap">
                {group.names.join(', ')}
              </Text>
            </Box>
          </Box>
        )}
        {open && group.items.length > 0 && itemRows(group.items, childGuides, key)}
      </Box>
    )
  }

  const startupSection = () => (
    <Box flexDirection="column">
      {heading(t(lang, 'startup'), data.startup ? startupTokens : undefined, t(lang, 'startup.note'))}
      {!data.startup && <Text dimColor>{`  ${t(lang, 'loading')}`}</Text>}
      {groups.map((group, index) => startupGroup(group, index === groups.length - 1))}
      {data.startup && data.startup.deferred.count > 0 && (
        <Text dimColor wrap="truncate-end">{`     ${t(lang, 'deferred', data.startup.deferred.count)}`}</Text>
      )}
    </Box>
  )

  const timeline = () => {
    const compacted = data.entries.filter(entry => entry.epoch < data.epoch && !entry.isOutside)
    const turns = new Map<number, Entry[]>()
    for (const entry of live) turns.set(entry.turn, [...(turns.get(entry.turn) ?? []), entry])
    const order = [...turns.keys()].sort((a, b) => a - b)
    const recent = order.slice(-RECENT_TURNS)
    const older = order.slice(0, -RECENT_TURNS)
    const olderEntries = older.flatMap(turn => turns.get(turn) ?? []).filter(entry => !entry.isOutside)
    const openFrom = recent.length - OPEN_TURNS

    return (
      <Box flexDirection="column">
        {startupSection()}
        {heading(t(lang, 'session'), sum(inWindow), t(lang, 'session.note', inWindow.length))}
        {live.length === 0 && compacted.length === 0 && <Text dimColor>{`  ${t(lang, 'session.empty')}`}</Text>}
        {compacted.length > 0 &&
          row({
            toggleKey: 'compacted',
            isOpenNow: isOpen('compacted', false),
            glyph: '≡',
            color: 'inactive',
            label: t(lang, 'compacted', compacted.length),
            detail: t(lang, 'compacted.note'),
            isQuiet: true,
          })}
        {compacted.length > 0 &&
          isOpen('compacted', false) &&
          compacted.map((entry, index) =>
            row({
              guide: branch('', index === compacted.length - 1),
              glyph: KINDS[entry.kind].glyph,
              color: 'inactive',
              label: tr(entry.label, entry.labelArg) ?? '',
              tokens: entry.tokens,
              isQuiet: true,
            }),
          )}
        {olderEntries.length > 0 &&
          row({
            toggleKey: 'older',
            isOpenNow: isOpen('older', false),
            glyph: '…',
            color: 'inactive',
            label: t(lang, 'older', older.length),
            detail: t(lang, 'items', olderEntries.length),
            tokens: sum(olderEntries),
            isQuiet: true,
          })}
        {olderEntries.length > 0 && isOpen('older', false) && (
          <Box flexDirection="column">
            {olderEntries
              .filter(entry => !entry.parent)
              .map((entry, index, list) => node(entry, '', index === list.length - 1))}
          </Box>
        )}
        {recent.map((turn, index) => {
          const list = turns.get(turn) ?? []
          const first = list[0]
          const head = first?.kind === 'prompt' || (first?.kind === 'command' && first.label.startsWith('/')) ? first : undefined
          const roots = list.filter(entry => entry !== head && (!entry.parent || !ids.has(entry.parent)))
          const firstAnswer = roots.findIndex(entry => !INJECTED.includes(entry.kind))
          const injected = firstAnswer < 0 ? roots : roots.slice(0, firstAnswer)
          const rest = firstAnswer < 0 ? [] : roots.slice(firstAnswer)
          const key = `turn:${data.epoch}:${turn}`
          const open = isOpen(key, index >= openFrom)
          const style = head ? KINDS[head.kind] : undefined
          const branches = (injected.length > 0 ? 1 : 0) + rest.length

          return (
            <Box flexDirection="column" marginTop={index === 0 ? 0 : 0}>
              {row({
                toggleKey: roots.length > 0 ? key : undefined,
                isOpenNow: open,
                glyph: style?.glyph ?? '·',
                color: style?.color ?? 'inactive',
                label: head ? (tr(head.label) ?? '') : t(lang, 'sessionStart'),
                isBold: true,
                detail: open ? undefined : t(lang, 'items', list.length - (head ? 1 : 0)),
                tokens: sum(list.filter(entry => !entry.isOutside)),
              })}
              {open && injected.length > 0 && injectedGroup(injected, `${key}:inject`, '', branches === 1)}
              {open && rest.map((entry, at) => node(entry, '', at === rest.length - 1))}
            </Box>
          )
        })}
      </Box>
    )
  }

  // ── Kinds ─────────────────────────────────────────────────────────────────

  type Category = { key: string; glyph: string; color: string; name: string; count: number; tokens: number; items: StartupItem[]; isQuiet?: boolean }

  const categoryRows = (list: Category[], total: number) =>
    [...list]
      .sort((a, b) => b.tokens - a.tokens)
      .map(category => {
        const open = isOpen(category.key, false)

        return (
          <Box flexDirection="column">
            {row({
              toggleKey: category.items.length > 0 ? category.key : undefined,
              isOpenNow: open,
              glyph: category.glyph,
              color: category.color,
              label: category.name,
              detail: category.count > 0 ? `${category.count}` : undefined,
              share: `${Math.round((category.tokens / total) * 100)}%`,
              tokens: category.tokens,
              isQuiet: category.isQuiet,
            })}
            {open && itemRows(category.items, '', category.key, total)}
          </Box>
        )
      })

  const byCategory = () => {
    const fromKind = (kind: EntryKind): Category | undefined => {
      const list = inWindow.filter(entry => entry.kind === kind)
      if (list.length === 0) return undefined

      return {
        key: `cat:${kind}`,
        glyph: KINDS[kind].glyph,
        color: KINDS[kind].color,
        name: t(lang, `kind.${kind}`),
        count: list.length,
        tokens: sum(list),
        isQuiet: KINDS[kind].isQuiet,
        items: [...list]
          .sort((a, b) => b.tokens - a.tokens)
          .map(entry => ({ label: tr(entry.label, entry.labelArg) ?? '', detail: tr(entry.detail, entry.detailArg), path: entry.path, tokens: entry.tokens })),
      }
    }
    const startup: Category[] = groups.map(group => ({
      key: `cat:start:${group.key}`,
      glyph: '■',
      color: group.color,
      name: tr(group.label) ?? group.key,
      count: group.names?.length ?? group.items.length,
      tokens: group.tokens,
      items: group.names ? group.names.map(name => ({ label: name, tokens: 0 })) : group.items,
    }))
    const sections: [string, string, Category[]][] = [
      [t(lang, 'startup'), t(lang, 'startup.note'), startup],
      [t(lang, 'section.onDemand'), t(lang, 'section.onDemand.note'), ON_DEMAND.map(fromKind).filter((one): one is Category => !!one)],
      [t(lang, 'section.conversation'), t(lang, 'section.conversation.note'), CONVERSATION.map(fromKind).filter((one): one is Category => !!one)],
    ]
    const total = Math.max(1, sum(sections.flatMap(([, , list]) => list)))

    return (
      <Box flexDirection="column">
        {sections.map(([title, note, list]) => (
          <Box flexDirection="column">
            {heading(title, sum(list), note)}
            {list.length === 0 && <Text dimColor>{`  ${t(lang, 'none')}`}</Text>}
            {categoryRows(list, total)}
          </Box>
        ))}
      </Box>
    )
  }

  // ── Top ───────────────────────────────────────────────────────────────────

  const topView = () => {
    type Item = { glyph: string; color: string; label: string; detail?: string; path?: string; tokens: number; badge?: string; isQuiet?: boolean }
    const items: Item[] = [
      ...groups.map(group => ({
        glyph: '■',
        color: group.color,
        label: tr(group.label) ?? group.key,
        badge: t(lang, 'badge.startup'),
        tokens: group.tokens,
      })),
      ...inWindow.map(entry => ({
        glyph: KINDS[entry.kind].glyph,
        color: KINDS[entry.kind].color,
        label: tr(entry.label, entry.labelArg) ?? '',
        detail: tr(entry.detail, entry.detailArg),
        path: entry.path,
        tokens: entry.tokens,
        isQuiet: KINDS[entry.kind].isQuiet,
      })),
    ].sort((a, b) => b.tokens - a.tokens)
    const total = Math.max(1, sum(items))
    const shown = isOpen('top:all', false) ? items.slice(0, 200) : items.slice(0, 25)
    const rank = String(shown.length).length
    let running = 0

    return (
      <Box flexDirection="column">
        {heading(t(lang, 'top.title'), total, t(lang, 'top.note'))}
        {shown.map((item, index) => {
          running += item.tokens
          return row({
            glyph: item.glyph,
            color: item.color,
            label: `${String(index + 1).padStart(rank)}  ${item.label}`,
            detail: item.detail,
            path: item.path,
            badge: item.badge,
            share: `${Math.round((running / total) * 100)}%`,
            tokens: item.tokens,
            isQuiet: item.isQuiet,
          })
        })}
        {items.length > shown.length && (
          <Box paddingLeft={4}>
            <Button key="top:all" plain dimColor label={t(lang, 'more', items.length - shown.length)} onPress={() => act.toggle('top:all')} />
          </Box>
        )}
      </Box>
    )
  }

  // ── Files ─────────────────────────────────────────────────────────────────

  const filesView = () => {
    type File = { path: string; ops: Map<string, number>; tokens: number }
    const files = new Map<string, File>()
    const note = (path: string, op: string, tokens: number) => {
      const file = files.get(path) ?? { path, ops: new Map(), tokens: 0 }
      file.ops.set(op, (file.ops.get(op) ?? 0) + 1)
      file.tokens += tokens
      files.set(path, file)
    }
    for (const group of groups) {
      for (const item of group.items) if (item.path) note(item.path, 'memory', item.tokens)
    }
    for (const entry of inWindow) {
      if (!entry.path) continue
      const op =
        entry.kind === 'skill'
          ? 'skill'
          : entry.kind === 'file'
            ? entry.label === 'att.file' || entry.label === 'att.directory' || entry.label === 'att.pdf_reference'
              ? 'ref'
              : 'inject'
            : entry.tool === 'Read'
              ? 'read'
              : entry.tool === 'Edit' || entry.tool === 'Write' || entry.tool === 'NotebookEdit'
                ? 'edit'
                : 'search'
      note(entry.path, op, entry.tokens)
    }
    const folders = new Map<string, File[]>()
    for (const file of files.values()) {
      const folder = file.path.slice(0, file.path.lastIndexOf('/')) || '/'
      folders.set(folder, [...(folders.get(folder) ?? []), file])
    }
    const ordered = [...folders].sort((a, b) => sum(b[1]) - sum(a[1]))

    return (
      <Box flexDirection="column">
        {heading(t(lang, 'files.title'), sum([...files.values()]), t(lang, 'files.note', files.size, ordered.length))}
        {files.size === 0 && <Text dimColor>{`  ${t(lang, 'files.empty')}`}</Text>}
        {ordered.map(([folder, list]) => {
          const key = `dir:${folder}`
          const open = isOpen(key, true)
          const sorted = [...list].sort((a, b) => b.tokens - a.tokens)

          return (
            <Box flexDirection="column">
              {row({
                toggleKey: key,
                isOpenNow: open,
                glyph: '▤',
                color: 'inactive',
                label: shortPath(`${folder}/x`).replace(/\/x$/, '/').replace(/^…\//, '…/'),
                isBold: true,
                detail: `${list.length}`,
                tokens: sum(list),
              })}
              {open &&
                sorted.map((file, index) => {
                  const ops = [...file.ops].map(([op, n]) => (n > 1 ? `${t(lang, `op.${op}`)}×${n}` : t(lang, `op.${op}`))).join(' ')
                  const reread = (file.ops.get('read') ?? 0) > 1

                  return row({
                    guide: branch('', index === sorted.length - 1),
                    glyph: reread ? '!' : '·',
                    color: reread ? 'warning' : 'inactive',
                    label: ops,
                    path: file.path,
                    badge: reread ? t(lang, 'badge.reread') : undefined,
                    badgeColor: reread ? 'warning' : undefined,
                    tokens: file.tokens,
                  })
                })}
            </Box>
          )
        })}
      </Box>
    )
  }

  // ── Origin ────────────────────────────────────────────────────────────────

  /** A bar of coloured segments, each `[color, tokens]`, scaled so `scale` fills `width`. */
  const stackedBar = (segments: readonly (readonly [string, number])[], scale: number, width: number) => {
    let used = 0
    const cells = segments.map(([color, tokens]) => {
      const n = Math.max(tokens > 0 ? 1 : 0, Math.round((tokens / Math.max(1, scale)) * width))
      const fit = Math.max(0, Math.min(n, width - used))
      used += fit
      return [color, fit] as const
    })

    return (
      <Text>
        {cells
          .filter(([, n]) => n > 0)
          .map(([color, n]) => (
            <Text color={color}>{'█'.repeat(n)}</Text>
          ))}
        <Text dimColor>{'░'.repeat(Math.max(0, width - used))}</Text>
      </Text>
    )
  }

  const originView = () => {
    const pick = (test: (entry: Entry) => boolean) => inWindow.filter(test)
    const isMention = (entry: Entry) => entry.label === 'att.file' || entry.label === 'att.directory' || entry.label === 'att.pdf_reference'
    const isHandBack = (entry: Entry) => entry.label === 'entry.handBack'
    const origins = [
      { key: 'you', glyph: '❯', color: 'suggestion', list: pick(e => e.kind === 'prompt' || e.kind === 'command' || (e.kind === 'file' && isMention(e))) },
      { key: 'model', glyph: '●', color: 'claude', list: pick(e => e.kind === 'reply' || e.kind === 'thinking') },
      { key: 'tools', glyph: '◆', color: 'success', list: pick(e => e.kind === 'tool' || e.kind === 'loaded') },
      { key: 'skills', glyph: '✦', color: 'autoAccept', list: pick(e => e.kind === 'skill') },
      { key: 'agents', glyph: '❖', color: 'permission', list: pick(e => e.kind === 'agent' || (e.kind === 'delivery' && isHandBack(e))) },
      {
        key: 'engine',
        glyph: '+',
        color: 'warning',
        list: pick(
          e =>
            e.kind === 'listing' ||
            e.kind === 'reminder' ||
            e.kind === 'compaction' ||
            (e.kind === 'file' && !isMention(e)) ||
            (e.kind === 'delivery' && !isHandBack(e)),
        ),
      },
      { key: 'hooks', glyph: '↳', color: 'ide', list: pick(e => e.kind === 'hook') },
      { key: 'plugins', glyph: '◇', color: 'inactive', list: pick(e => e.kind === 'note') },
    ]
    const all = [
      { key: 'startup', glyph: '■', color: 'inactive', list: [] as Entry[], tokens: startupTokens },
      ...origins.map(origin => ({ ...origin, tokens: sum(origin.list) })),
    ]
      .filter(origin => origin.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
    const total = Math.max(1, sum(all))
    const width = Math.max(10, data.columns - 2)

    return (
      <Box flexDirection="column">
        {heading(t(lang, 'origin.title'), total, t(lang, 'origin.note'))}
        <Box paddingLeft={1}>{stackedBar(all.map(origin => [origin.color, origin.tokens] as const), total, width)}</Box>
        {all.map(origin => {
          const key = `origin:${origin.key}`
          const open = isOpen(key, false)

          return (
            <Box flexDirection="column">
              {row({
                toggleKey: origin.list.length > 0 ? key : undefined,
                isOpenNow: open,
                glyph: origin.glyph,
                color: origin.color,
                label: t(lang, `origin.${origin.key}`),
                detail: origin.list.length > 0 ? `${origin.list.length}` : undefined,
                share: `${Math.round((origin.tokens / total) * 100)}%`,
                tokens: origin.tokens,
              })}
              {open &&
                itemRows(
                  [...origin.list]
                    .sort((a, b) => b.tokens - a.tokens)
                    .map(entry => ({ label: tr(entry.label, entry.labelArg) ?? '', detail: tr(entry.detail, entry.detailArg), path: entry.path, tokens: entry.tokens })),
                  '',
                  key,
                  total,
                )}
            </Box>
          )
        })}
      </Box>
    )
  }

  // ── Growth ────────────────────────────────────────────────────────────────

  const growthView = () => {
    const turns = new Map<number, Entry[]>()
    for (const entry of inWindow) turns.set(entry.turn, [...(turns.get(entry.turn) ?? []), entry])
    const order = [...turns.keys()].sort((a, b) => a - b).slice(-30)
    const rows = order.map(turn => {
      const list = turns.get(turn) ?? []
      const head = list.find(entry => entry.kind === 'prompt' || entry.kind === 'command')
      const byKind = (Object.keys(KINDS) as EntryKind[])
        .map(kind => [KINDS[kind].color, sum(list.filter(entry => entry.kind === kind))] as const)
        .filter(([, tokens]) => tokens > 0)

      return { turn, label: head ? (tr(head.label) ?? '') : t(lang, 'sessionStart'), tokens: sum(list), byKind }
    })
    const max = Math.max(startupTokens, ...rows.map(one => one.tokens), 1)
    const labelWidth = 14
    const width = Math.max(8, data.columns - labelWidth - TOKENS_WIDTH * 2 - 2)
    let running = startupTokens
    const legend = (Object.keys(KINDS) as EntryKind[]).filter(kind => inWindow.some(entry => entry.kind === kind))
    const bar = (label: string, segments: readonly (readonly [string, number])[], tokens: number, isQuiet = false) => (
      <Box flexDirection="row">
        <Box width={labelWidth} flexShrink={0}>
          <Text dimColor={isQuiet} wrap="truncate-end">
            {label}
          </Text>
        </Box>
        <Box flexShrink={0}>{stackedBar(segments, max, width)}</Box>
        <Box flexShrink={0} width={TOKENS_WIDTH} justifyContent="flex-end">
          <Text color={sizeColor(tokens)} dimColor={!sizeColor(tokens)}>
            {formatTokens(tokens)}
          </Text>
        </Box>
        <Box flexShrink={0} width={TOKENS_WIDTH} justifyContent="flex-end">
          <Text dimColor>{formatTokens(running)}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {heading(t(lang, 'growth.title'), startupTokens + sum(inWindow), t(lang, 'growth.note'))}
        {bar(t(lang, 'growth.startup'), [['inactive', startupTokens]], startupTokens, true)}
        {rows.map(one => {
          running += one.tokens
          return bar(`${String(one.turn).padStart(2)} ${one.label}`, one.byKind, one.tokens)
        })}
        <Box marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={2}>
          {legend.map(kind => (
            <Text>
              <Text color={KINDS[kind].color}>■</Text>
              <Text dimColor>{` ${t(lang, `kind.${kind}`)}`}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  }

  // ── Header ────────────────────────────────────────────────────────────────

  const header = () => {
    const fill = data.fill
    const percent = fill?.percent
    const shown = Math.min(100, Math.max(0, percent ?? 0))
    const barWidth = Math.max(10, data.columns - 1)
    const filled = Math.round((shown / 100) * barWidth)
    const color = fillColor(shown)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box flexShrink={0}>
            <Text>
              <Text bold>{t(lang, 'title')}</Text>
              <Text bold color={color}>{`  ${percent === undefined ? '—' : `${Math.round(percent)}%`}`}</Text>
              <Text dimColor>
                {fill?.tokens === undefined
                  ? `  ${t(lang, 'noResponse', formatTokens(fill?.window ?? 0))}`
                  : `  ${formatTokens(fill.tokens)} / ${formatTokens(fill.window)}`}
              </Text>
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end" marginLeft={2} marginRight={3}>
            <Text dimColor wrap="truncate-start">
              {fill?.model ?? ''}
            </Text>
          </Box>
        </Box>
        <Text>
          <Text color={color}>{'━'.repeat(filled)}</Text>
          <Text dimColor>{'─'.repeat(barWidth - filled)}</Text>
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {VIEWS.map(([view, hotkey]) => (
            <Button
              key={`view:${view}`}
              plain
              label={data.view === view ? `${t(lang, `view.${view}`)}◂` : t(lang, `view.${view}`)}
              hotkey={hotkey}
              dimColor={data.view !== view}
              onPress={() => act.setView(view)}
            />
          ))}
          <Button key="refresh" plain label={t(lang, 'refresh')} hotkey="r" dimColor onPress={act.refresh} />
        </Box>
        {data.isInline && (
          <Text dimColor wrap="wrap">
            {t(lang, 'inlineHint')}
          </Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingTop={1}>
      {header()}
      {data.view === 'category'
        ? byCategory()
        : data.view === 'top'
          ? topView()
          : data.view === 'files'
            ? filesView()
            : data.view === 'origin'
              ? originView()
              : data.view === 'growth'
                ? growthView()
                : timeline()}
    </Box>
  )
}
