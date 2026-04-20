import { Box, Text, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ResolvedEnv } from '../env.js'
import type { Flow, Step } from '../parser/types.js'
import { runFlow } from '../runner/runner.js'
import type { FlowReport, StepReport } from '../runner/types.js'
import { theme } from '../theme.js'
import type { LoadedFile } from './App.js'
import {
  Duration,
  Kbd,
  MethodBadge,
  ProgressBar,
  StatusIcon
} from './primitives.js'

type Pane = 'files' | 'steps' | 'response'
type Tab = 'request' | 'response' | 'headers' | 'tests'

interface Props {
  files: LoadedFile[]
  initialIndex: number
  root: string
  envName?: string
  failFast?: boolean
  onlyStep?: string
  resolveEnvFor: (path: string, envName: string) => Promise<ResolvedEnv>
  onQuit: () => void
}

interface FileRunState {
  reports: Record<number, StepReport>
  runningIndex: number | null
  flowReport: FlowReport | null
  startMs: number
}

const DEFAULT_ENV = 'local'

export function RunScreen({
  files,
  initialIndex,
  root,
  envName,
  failFast,
  onlyStep,
  resolveEnvFor,
  onQuit
}: Props) {
  const [activeIdx, setActiveIdx] = useState(initialIndex)
  const [selectedStep, setSelectedStep] = useState(0)
  const [activePane, setActivePane] = useState<Pane>('steps')
  const [tab, setTab] = useState<Tab>('response')
  const [now, setNow] = useState(Date.now())

  // Per-file run state + resolved env (cached).
  const [stateByFile, setStateByFile] = useState<Record<string, FileRunState>>(
    {}
  )
  const [envByFile, setEnvByFile] = useState<Record<string, ResolvedEnv>>({})
  const [envError, setEnvError] = useState<string | null>(null)

  const active = files[activeIdx]!
  const activePath = active.file.path
  const envKey = envName ?? DEFAULT_ENV

  // Resolve the env for the active file once per (file, envName) pair.
  useEffect(() => {
    if (envByFile[activePath]) return
    let cancelled = false
    resolveEnvFor(activePath, envKey)
      .then((env) => {
        if (cancelled) return
        setEnvByFile((m) => ({ ...m, [activePath]: env }))
        setEnvError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setEnvError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [activePath, envKey, resolveEnvFor, envByFile])

  // Tick for live elapsed.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [])

  // Clamp selection when switching files.
  useEffect(() => {
    setSelectedStep(0)
    setTab('response')
  }, [activeIdx])

  const fileRunStateRef = useRef(stateByFile)
  fileRunStateRef.current = stateByFile

  const triggerRun = useCallback(
    async (
      path: string,
      flow: Flow,
      opts?: { env?: ResolvedEnv; onlyStep?: string }
    ) => {
      const env = opts?.env ?? envByFile[path]
      if (!env) return
      const effectiveOnly = opts?.onlyStep ?? onlyStep
      const startMs = Date.now()
      setStateByFile((m) => ({
        ...m,
        [path]: {
          reports: {},
          runningIndex: 0,
          flowReport: null,
          startMs
        }
      }))
      try {
        await runFlow(flow, {
          env,
          failFast,
          onlySteps: effectiveOnly ? new Set([effectiveOnly]) : undefined,
          onEvent: (ev) => {
            setStateByFile((m) => {
              const prev = m[path] ?? {
                reports: {},
                runningIndex: null,
                flowReport: null,
                startMs
              }
              if (ev.kind === 'step:start') {
                return {
                  ...m,
                  [path]: { ...prev, runningIndex: ev.stepIndex }
                }
              }
              if (ev.kind === 'step:done') {
                return {
                  ...m,
                  [path]: {
                    ...prev,
                    reports: { ...prev.reports, [ev.stepIndex]: ev.report }
                  }
                }
              }
              if (ev.kind === 'flow:done') {
                return {
                  ...m,
                  [path]: {
                    ...prev,
                    runningIndex: null,
                    flowReport: ev.report
                  }
                }
              }
              return m
            })
          }
        })
      } catch (err) {
        // Surface fatal errors as a banner — shouldn't happen since runFlow
        // swallows per-step errors.
        setEnvError(err instanceof Error ? err.message : String(err))
      }
    },
    [envByFile, failFast, onlyStep]
  )

  const [runningAll, setRunningAll] = useState(false)

  const ensureEnv = useCallback(
    async (path: string): Promise<ResolvedEnv | undefined> => {
      const cached = envByFile[path]
      if (cached) return cached
      try {
        const resolved = await resolveEnvFor(path, envKey)
        setEnvByFile((m) => ({ ...m, [path]: resolved }))
        return resolved
      } catch (err) {
        setEnvError(err instanceof Error ? err.message : String(err))
        return undefined
      }
    },
    [envByFile, envKey, resolveEnvFor]
  )

  const triggerRunSelected = useCallback(async () => {
    const step = active.flow.steps[selectedStep]
    if (!step) return
    const env = await ensureEnv(activePath)
    if (!env) return
    await triggerRun(activePath, active.flow, { env, onlyStep: step.num })
  }, [active.flow, activePath, ensureEnv, selectedStep, triggerRun])

  const triggerRunCurrent = useCallback(async () => {
    const env = await ensureEnv(activePath)
    if (!env) return
    await triggerRun(activePath, active.flow, { env })
  }, [active.flow, activePath, ensureEnv, triggerRun])

  const triggerRunAll = useCallback(async () => {
    if (runningAll) return
    setRunningAll(true)
    try {
      for (const loaded of files) {
        const env = await ensureEnv(loaded.file.path)
        if (!env) continue
        await triggerRun(loaded.file.path, loaded.flow, { env })
      }
    } finally {
      setRunningAll(false)
    }
  }, [ensureEnv, files, runningAll, triggerRun])

  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 120
  const rows = stdout?.rows ?? 30
  // Three layout breakpoints:
  //   wide   (≥130): full three-pane
  //   medium (80–129): files pane is narrower
  //   narrow (<80): files pane hidden; 'f' key toggles an overlay
  const layout: 'wide' | 'medium' | 'narrow' =
    cols >= 130 ? 'wide' : cols >= 80 ? 'medium' : 'narrow'
  const showFiles = layout !== 'narrow'
  const filesWidth = layout === 'wide' ? 30 : layout === 'medium' ? 24 : 0
  const stepsWidth =
    layout === 'wide'
      ? Math.max(34, Math.floor(cols * 0.3))
      : layout === 'medium'
        ? Math.max(28, Math.floor(cols * 0.38))
        : Math.max(26, Math.floor(cols * 0.45))
  const responseWidth = Math.max(
    24,
    cols - (showFiles ? filesWidth : 0) - stepsWidth
  )
  // Vertical budget: 1 for envError (if any) + 1 for StatusBar.
  const contentRows = Math.max(5, rows - 1 - (envError ? 1 : 0))

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onQuit()
      return
    }
    if (input === 'r') {
      triggerRunCurrent()
      return
    }
    if (input === 's') {
      triggerRunSelected()
      return
    }
    if (input === 'a') {
      triggerRunAll()
      return
    }
    // File cycling works from any pane — handy when Files pane is hidden.
    if (input === ',' || input === '[') {
      setActiveIdx(Math.max(0, activeIdx - 1))
      return
    }
    if (input === '.' || input === ']') {
      setActiveIdx(Math.min(files.length - 1, activeIdx + 1))
      return
    }
    if (input === '1' && showFiles) setActivePane('files')
    else if (input === '2') setActivePane('steps')
    else if (input === '3') setActivePane('response')
    else if (key.tab || key.rightArrow)
      setActivePane(nextPane(activePane, showFiles))
    else if (key.leftArrow) setActivePane(prevPane(activePane, showFiles))
    else if (key.upArrow) {
      if (activePane === 'files') setActiveIdx(Math.max(0, activeIdx - 1))
      else if (activePane === 'steps')
        setSelectedStep(Math.max(0, selectedStep - 1))
    } else if (key.downArrow) {
      if (activePane === 'files')
        setActiveIdx(Math.min(files.length - 1, activeIdx + 1))
      else if (activePane === 'steps')
        setSelectedStep(
          Math.min(Math.max(0, active.flow.steps.length - 1), selectedStep + 1)
        )
    } else if (input === 'h' && activePane === 'response') setTab(prevTab(tab))
    else if (input === 'l' && activePane === 'response') setTab(nextTab(tab))
    else if (key.return && activePane === 'files') {
      setActivePane('steps')
    }
  })

  const runState = stateByFile[activePath]
  const summary = useMemo(
    () => computeSummary(runState, active.flow.steps.length),
    [runState, active.flow.steps.length]
  )
  const elapsed = runState?.flowReport
    ? runState.flowReport.durationMs
    : runState?.startMs
      ? now - runState.startMs
      : 0

  const selectedStepData: Step | undefined = active.flow.steps[selectedStep]
  const selectedReport = runState?.reports[selectedStep]

  return (
    <Box
      flexDirection="column"
      height={rows - 1}
    >
      {envError && (
        <Box paddingX={1}>
          <Text color={theme.red}>env error: {envError}</Text>
        </Box>
      )}
      <Box
        flexGrow={1}
        height={contentRows}
      >
        {showFiles && (
          <Box
            width={filesWidth}
            height={contentRows}
            flexDirection="column"
            borderStyle="single"
            borderColor={theme.border}
            borderTop={false}
            borderLeft={false}
            borderBottom={false}
          >
            <PaneHeader
              title="Files"
              shortcut="1"
              active={activePane === 'files'}
              right={
                <Text color={theme.fgSubtle}>
                  {activeIdx + 1}/{files.length}
                </Text>
              }
            />
            <FilesList
              files={files}
              activeIdx={activeIdx}
              paneActive={activePane === 'files'}
              stateByFile={stateByFile}
              root={root}
              width={filesWidth}
              height={contentRows - 2}
            />
          </Box>
        )}
        <Box
          width={stepsWidth}
          height={contentRows}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.border}
          borderTop={false}
          borderLeft={false}
          borderBottom={false}
        >
          <PaneHeader
            title="HTTP Requests"
            shortcut="2"
            active={activePane === 'steps'}
            right={
              <>
                <Text color={theme.green}>{summary.passed}</Text>
                <Text color={theme.fgSubtle}> · </Text>
                <Text color={summary.failed > 0 ? theme.red : theme.fgSubtle}>
                  {summary.failed}
                </Text>
                <Text color={theme.fgSubtle}> / {summary.totalTests}</Text>
              </>
            }
          />
          <Box
            paddingX={1}
            flexDirection="column"
            flexShrink={0}
          >
            <Text color={theme.fg}>
              {truncateRight(
                stripHttp(active.file.relPath || active.file.path),
                stepsWidth - 2
              )}
            </Text>
            <ProgressBar
              value={summary.doneSteps}
              total={Math.max(1, active.flow.steps.length)}
              width={stepsWidth - 4}
              variant={
                summary.failed > 0
                  ? 'fail'
                  : summary.doneSteps === active.flow.steps.length &&
                      summary.doneSteps > 0
                    ? 'success'
                    : 'brand'
              }
            />
          </Box>
          <StepsList
            steps={active.flow.steps}
            stepsKeyPrefix={activePath}
            runState={runState}
            selectedStep={selectedStep}
            width={stepsWidth}
            height={Math.max(1, contentRows - 5)}
          />
        </Box>
        <Box
          width={responseWidth}
          height={contentRows}
          flexDirection="column"
        >
          <PaneHeader
            title="Response"
            shortcut="3"
            active={activePane === 'response'}
            right={
              selectedReport ? (
                <ResponseStatusChip report={selectedReport} />
              ) : null
            }
          />
          {selectedStepData && (
            <TabRow
              tab={tab}
              onChange={setTab}
              report={selectedReport}
            />
          )}
          <Box
            flexDirection="column"
            paddingX={1}
            height={Math.max(1, contentRows - 3)}
            overflow="hidden"
          >
            {selectedStepData && (
              <TabBody
                report={selectedReport}
                step={selectedStepData}
                tab={tab}
                width={responseWidth - 2}
                maxLines={Math.max(1, contentRows - 5)}
              />
            )}
          </Box>
        </Box>
      </Box>
      <StatusBar
        activePane={activePane}
        runState={runState}
        env={envByFile[activePath]?.name ?? envKey}
        summary={summary}
        elapsed={elapsed}
      />
    </Box>
  )
}

function FilesList({
  files,
  activeIdx,
  paneActive,
  stateByFile,
  root,
  width,
  height
}: {
  files: LoadedFile[]
  activeIdx: number
  paneActive: boolean
  stateByFile: Record<string, FileRunState>
  root: string
  width: number
  height: number
}) {
  const visible = Math.max(3, height)
  const start = Math.max(
    0,
    Math.min(
      activeIdx - Math.floor(visible / 2),
      Math.max(0, files.length - visible)
    )
  )
  const slice = files.slice(start, start + visible)
  // Column widths: 2 (caret) + 1 (status icon) + 1 (space) + name + 1 (space) + count + 1 (padding)
  const countWidth = 3
  const nameWidth = Math.max(6, width - 2 - 1 - 1 - countWidth - 2)

  return (
    <Box
      flexDirection="column"
      height={visible}
    >
      {slice.map((f, i) => {
        const idx = start + i
        const isActive = idx === activeIdx
        const state = stateByFile[f.file.path]
        const status = statusFromState(state)
        const displayName = stripHttp(
          f.file.relPath || f.file.path.slice(root.length + 1) || f.file.path
        )
        const name = padRight(truncateRight(displayName, nameWidth), nameWidth)
        const count = padLeft(String(f.flow.steps.length), countWidth)
        return (
          <Box
            key={f.file.path}
            height={1}
          >
            <Text color={isActive && paneActive ? theme.brand : theme.fgSubtle}>
              {isActive ? '▸ ' : '  '}
            </Text>
            <StatusIcon status={status} />
            <Text> </Text>
            <Text color={isActive ? theme.fg : theme.fgDim}>{name}</Text>
            <Text color={theme.fgSubtle}> {count}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function truncateRight(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 1) return '…'
  return s.slice(0, max - 1) + '…'
}
function padRight(s: string, width: number): string {
  if (s.length >= width) return s
  return s + ' '.repeat(width - s.length)
}
function padLeft(s: string, width: number): string {
  if (s.length >= width) return s
  return ' '.repeat(width - s.length) + s
}

function StepsList({
  steps,
  stepsKeyPrefix,
  runState,
  selectedStep,
  width,
  height
}: {
  steps: Step[]
  stepsKeyPrefix: string
  runState: FileRunState | undefined
  selectedStep: number
  width: number
  height: number
}) {
  if (steps.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={theme.fgSubtle}>(no steps)</Text>
      </Box>
    )
  }
  const visible = Math.max(1, height)
  const start = Math.max(
    0,
    Math.min(
      selectedStep - Math.floor(visible / 2),
      Math.max(0, steps.length - visible)
    )
  )
  const slice = steps.slice(start, start + visible)
  // Column budget: caret(2) + icon(1) + sp(1) + method(6) + num(4) + title + duration(7)
  const titleWidth = Math.max(6, width - 2 - 1 - 1 - 6 - 1 - 4 - 1 - 7 - 1)
  return (
    <Box
      flexDirection="column"
      height={visible}
    >
      {slice.map((step, i) => {
        const idx = start + i
        const report = runState?.reports[idx]
        const isSelected = idx === selectedStep
        const isRunning = runState?.runningIndex === idx && !report
        const status = report?.status ?? (isRunning ? 'running' : 'pending')
        return (
          <Box
            key={`${stepsKeyPrefix}-${step.num}-${idx}`}
            height={1}
          >
            <Text color={isSelected ? theme.brand : theme.fgSubtle}>
              {isSelected ? '▸ ' : '  '}
            </Text>
            <StatusIcon status={status} />
            <Text> </Text>
            <MethodBadge method={step.method} />
            <Text color={theme.fgSubtle}> {step.num.padEnd(4)}</Text>
            <Text color={isSelected ? theme.fg : theme.fgDim}>
              {' '}
              {truncateRight(step.title || step.url, titleWidth)}
            </Text>
            <Box flexGrow={1} />
            <Duration
              ms={report?.durationMs}
              running={isRunning}
            />
          </Box>
        )
      })}
    </Box>
  )
}

function statusFromState(state: FileRunState | undefined) {
  if (!state) return 'pending' as const
  if (state.flowReport) return state.flowReport.status
  if (state.runningIndex !== null) return 'running' as const
  return 'pending' as const
}

function stripHttp(name: string): string {
  return name.replace(/\.http$/, '')
}

function PaneHeader({
  title,
  shortcut,
  active,
  right
}: {
  title: string
  shortcut: string
  active: boolean
  right?: React.ReactNode
}) {
  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text
        color={active ? theme.brand : theme.fgSubtle}
        bold
      >
        {title.toUpperCase()}
      </Text>
      <Text color={theme.fgSubtle}> [{shortcut}]</Text>
      <Box flexGrow={1} />
      {right}
    </Box>
  )
}

function ResponseStatusChip({ report }: { report: StepReport }) {
  const s = report.response?.status
  if (report.status === 'pass' && s) {
    return (
      <Text
        color={theme.green}
        bold
      >
        ● {s} OK
      </Text>
    )
  }
  if (report.status === 'fail')
    return (
      <Text
        color={theme.red}
        bold
      >
        ● Failed
      </Text>
    )
  if (report.status === 'error')
    return (
      <Text
        color={theme.red}
        bold
      >
        ● Error
      </Text>
    )
  if (report.status === 'running')
    return <Text color={theme.brand}>● Running</Text>
  return <Text color={theme.fgSubtle}>○ Idle</Text>
}

function TabRow({
  tab,
  onChange: _onChange,
  report
}: {
  tab: Tab
  onChange: (t: Tab) => void
  report?: StepReport
}) {
  const tabs: Tab[] = ['request', 'response', 'headers', 'tests']
  const testCount = report?.tests.length ?? 0
  const testPassed = report?.tests.filter((t) => t.passed).length ?? 0
  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
    >
      {tabs.map((t) => {
        const active = tab === t
        return (
          <Box
            key={t}
            paddingX={1}
          >
            <Text
              color={active ? theme.fg : theme.fgDim}
              bold={active}
              underline={active}
            >
              {cap(t)}
            </Text>
            {t === 'tests' && report && (
              <Text
                color={testPassed === testCount ? theme.green : theme.fgSubtle}
              >
                {' '}
                {testPassed}/{testCount}
              </Text>
            )}
          </Box>
        )
      })}
      <Box flexGrow={1} />
      <Text color={theme.fgSubtle}>h l switch</Text>
    </Box>
  )
}

function TabBody({
  report,
  step,
  tab,
  width,
  maxLines
}: {
  report?: StepReport
  step: Step
  tab: Tab
  width: number
  maxLines: number
}) {
  if (!report) {
    return (
      <Text color={theme.fgSubtle}>
        Not run yet. <Text color={theme.brand}>s</Text> step ·{' '}
        <Text color={theme.brand}>r</Text> file ·{' '}
        <Text color={theme.brand}>a</Text> all
      </Text>
    )
  }
  if (tab === 'request') {
    const prepared = report.prepared
    const header = `${step.method} ${prepared?.url ?? step.url}`
    return (
      <Box flexDirection="column">
        <Text color={theme.cyan}>{truncate(header, width)}</Text>
        {Object.entries(prepared?.headers ?? {}).map(([k, v]) => (
          <Text key={k}>
            <Text color={theme.fgDim}>{k}</Text>
            <Text color={theme.fgSubtle}>: </Text>
            <Text color={theme.fg}>{truncate(v, width - k.length - 2)}</Text>
          </Text>
        ))}
        {prepared?.body && (
          <Box
            marginTop={1}
            flexDirection="column"
          >
            <Text color={theme.fgSubtle}>body:</Text>
            <Text>{truncate(prepared.body, width * 6)}</Text>
          </Box>
        )}
      </Box>
    )
  }
  if (tab === 'headers') {
    return (
      <Box flexDirection="column">
        <Text color={theme.cyan}>
          HTTP {report.response?.status} {report.response?.statusText}
        </Text>
        {Object.entries(report.response?.headers ?? {}).map(([k, v]) => (
          <Text key={k}>
            <Text color={theme.fgDim}>{k}</Text>
            <Text color={theme.fgSubtle}>: </Text>
            <Text color={theme.fg}>{truncate(v, width - k.length - 2)}</Text>
          </Text>
        ))}
      </Box>
    )
  }
  if (tab === 'tests') {
    if (report.tests.length === 0)
      return <Text color={theme.fgSubtle}>(no tests)</Text>
    return (
      <Box flexDirection="column">
        {report.tests.map((t) => (
          <Box key={t.name}>
            <StatusIcon status={t.passed ? 'pass' : 'fail'} />
            <Text> </Text>
            <Text color={t.passed ? theme.fg : theme.red}>{t.name}</Text>
            {t.message && (
              <Text color={theme.fgSubtle}>
                {' '}
                — {truncate(t.message, width - t.name.length - 5)}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    )
  }
  if (report.error && !report.response) {
    return (
      <Box flexDirection="column">
        <Text color={theme.red}>
          {report.error.phase}: {report.error.message}
        </Text>
      </Box>
    )
  }
  const body = report.response?.rawBody ?? ''
  const pretty = tryPretty(body, report.response?.contentType)
  const trimmedLines = clipLines(pretty, maxLines - 1, width)
  return (
    <Box flexDirection="column">
      {report.response && (
        <Text color={theme.fgSubtle}>
          {report.response.status} {report.response.statusText} ·{' '}
          {report.durationMs}ms · {body.length}B
        </Text>
      )}
      {trimmedLines.map((line, i) => (
        <Text
          key={i}
          wrap="truncate"
        >
          {line}
        </Text>
      ))}
    </Box>
  )
}

function clipLines(text: string, maxLines: number, width: number): string[] {
  const raw = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < Math.min(raw.length, Math.max(0, maxLines)); i += 1) {
    out.push(truncateRight(raw[i]!, Math.max(1, width)))
  }
  if (raw.length > maxLines) {
    out[out.length - 1] = truncateRight(
      `… (${raw.length - maxLines} more lines)`,
      Math.max(1, width)
    )
  }
  return out
}

function StatusBar({
  activePane: _activePane,
  runState,
  env,
  summary,
  elapsed
}: {
  activePane: Pane
  runState: FileRunState | undefined
  env: string
  summary: { passed: number; failed: number; totalTests: number }
  elapsed: number
}) {
  const mode = runState?.flowReport
    ? runState.flowReport.status === 'fail'
      ? 'FAIL'
      : 'DONE'
    : runState?.runningIndex !== null && runState?.runningIndex !== undefined
      ? 'RUN'
      : 'IDLE'
  const modeColor =
    mode === 'FAIL'
      ? theme.red
      : mode === 'DONE'
        ? theme.green
        : mode === 'RUN'
          ? theme.brand
          : theme.fgSubtle
  const modeGlyph =
    mode === 'FAIL' ? '✗' : mode === 'DONE' ? '✓' : mode === 'RUN' ? '●' : '○'
  return (
    <Box>
      <Text
        color={modeColor}
        bold
      >
        {modeGlyph} {mode}
      </Text>
      <Text color={theme.fgDim}> env:</Text>
      <Text color={theme.brand}> {env}</Text>
      <Text color={theme.fgSubtle}> | </Text>
      <Text color={theme.green}>{summary.passed}</Text>
      <Text color={theme.fgSubtle}> pass · </Text>
      <Text color={summary.failed > 0 ? theme.red : theme.fgSubtle}>
        {summary.failed}
      </Text>
      <Text color={theme.fgSubtle}> fail · {summary.totalTests} tests</Text>
      <Text color={theme.fgSubtle}> | </Text>
      <Text color={theme.fg}>{formatMs(elapsed)}</Text>
      <Box flexGrow={1} />
      <Kbd
        k="s"
        label="step"
      />
      <Text> </Text>
      <Kbd
        k="r"
        label="file"
      />
      <Text> </Text>
      <Kbd
        k="a"
        label="all"
      />
      <Text> </Text>
      <Kbd
        k="↹"
        label="pane"
      />
      <Text> </Text>
      <Kbd
        k="q"
        label="quit"
      />
    </Box>
  )
}

function computeSummary(
  state: FileRunState | undefined,
  _totalSteps: number
): { passed: number; failed: number; totalTests: number; doneSteps: number } {
  let passed = 0
  let failed = 0
  let doneSteps = 0
  let totalTests = 0
  if (state) {
    for (const r of Object.values(state.reports)) {
      doneSteps += 1
      for (const t of r.tests) {
        totalTests += 1
        if (t.passed) passed += 1
        else failed += 1
      }
    }
  }
  return { passed, failed, totalTests, doneSteps }
}

function nextPane(p: Pane, showFiles: boolean): Pane {
  if (showFiles) {
    return p === 'files' ? 'steps' : p === 'steps' ? 'response' : 'files'
  }
  return p === 'steps' ? 'response' : 'steps'
}
function prevPane(p: Pane, showFiles: boolean): Pane {
  if (showFiles) {
    return p === 'files' ? 'response' : p === 'steps' ? 'files' : 'steps'
  }
  return p === 'steps' ? 'response' : 'steps'
}
function nextTab(t: Tab): Tab {
  const order: Tab[] = ['request', 'response', 'headers', 'tests']
  return order[(order.indexOf(t) + 1) % order.length]!
}
function prevTab(t: Tab): Tab {
  const order: Tab[] = ['request', 'response', 'headers', 'tests']
  return order[(order.indexOf(t) - 1 + order.length) % order.length]!
}
function cap(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1)
}
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}
function tryPretty(body: string, contentType: string | undefined): string {
  if (contentType && /\bjson\b/i.test(contentType)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      // fall through
    }
  }
  return body
}
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
