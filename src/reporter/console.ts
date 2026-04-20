import type { FlowReport, StepReport } from '../runner/types.js'
import { methodColor, statusIcon, theme } from '../theme.js'

const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY

function hex(hex: string): (s: string) => string {
  if (NO_COLOR) return (s) => s
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
}

function dim(s: string): string {
  return NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`
}

const brand = hex(theme.brand)
const green = hex(theme.green)
const red = hex(theme.red)
const yellow = hex(theme.yellow)
const cyan = hex(theme.cyan)
const subtle = hex(theme.fgSubtle)

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function iconForStatus(s: StepReport['status']): string {
  switch (s) {
    case 'pass':
      return green(statusIcon.pass)
    case 'fail':
      return red(statusIcon.fail)
    case 'error':
      return red(statusIcon.error)
    case 'running':
      return brand(statusIcon.running)
    case 'skipped':
      return subtle(statusIcon.skipped)
    default:
      return subtle(statusIcon.pending)
  }
}

export function printFlowStart(flowFile: string, env: string): void {
  const rel = flowFile
  console.log()
  console.log(`${brand('pawsh')} ${dim('running')} ${rel}`)
  console.log(`${dim('env:')} ${cyan(env)}`)
  console.log()
}

export function printStepReport(r: StepReport): void {
  const icon = iconForStatus(r.status)
  const method = hex(methodColor[r.step.method] ?? theme.fgDim)(
    r.step.method.padEnd(6)
  )
  const num = subtle(r.step.num.padStart(4))
  const duration = r.durationMs > 0 ? dim(formatDuration(r.durationMs)) : ''
  console.log(
    `  ${icon} ${num} ${method} ${r.step.title || r.step.url}  ${duration}`
  )

  if (r.error) {
    console.log(
      `      ${red('error')} ${dim(`(${r.error.phase})`)} ${r.error.message}`
    )
  }
  for (const t of r.tests) {
    if (t.passed) continue
    console.log(
      `      ${red(statusIcon.fail)} ${t.name} — ${dim(t.message ?? '')}`
    )
  }
  if (r.response && (r.status === 'fail' || r.status === 'error')) {
    const body = r.response.rawBody.slice(0, 400)
    if (body.length > 0) {
      console.log(
        dim(
          `      ${yellow(`${r.response.status}`)} ${r.response.statusText}  →  ${body}`
        )
      )
    }
  }
}

export function printFlowSummary(report: FlowReport): void {
  const totalTests = report.steps.reduce((a, s) => a + s.tests.length, 0)
  const passed = report.steps.reduce(
    (a, s) => a + s.tests.filter((t) => t.passed).length,
    0
  )
  const failed = totalTests - passed
  const okSteps = report.steps.filter((s) => s.status === 'pass').length
  const failSteps = report.steps.filter(
    (s) => s.status === 'fail' || s.status === 'error'
  ).length

  console.log()
  const head =
    report.status === 'pass'
      ? green('✓ DONE')
      : report.status === 'skipped'
        ? subtle('○ SKIPPED')
        : red('✗ FAIL')
  console.log(
    `${head}  ${green(`${okSteps} ok`)} ${dim('·')} ${failed > 0 ? red(`${failSteps} failed`) : subtle('0 failed')} ${dim('·')} ${cyan(`${passed}/${totalTests} tests`)} ${dim('·')} ${dim(formatDuration(report.durationMs))}`
  )
}
