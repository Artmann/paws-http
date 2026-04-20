/**
 * Terminal-friendly palette. Dark by default, purple-accented to sit next to
 * conventional terminal greens/reds. Ink renders these as 24-bit truecolor.
 */

export const theme = {
  brand: '#9a7dff',
  brandDim: '#7a5eff',
  green: '#5fd78f',
  greenDim: '#3ea06a',
  red: '#ff6a6a',
  redDim: '#c94a4a',
  yellow: '#e6c36a',
  blue: '#7da6ff',
  cyan: '#7fc8d4',
  fg: '#e6e3ea',
  fgDim: '#a09eb0',
  fgSubtle: '#6a687a',
  border: '#2a2734'
} as const

export const methodColor: Record<string, string> = {
  GET: theme.green,
  POST: theme.yellow,
  PUT: theme.blue,
  PATCH: theme.blue,
  DELETE: theme.red,
  HEAD: theme.cyan,
  OPTIONS: theme.cyan
}

export const statusIcon = {
  pass: '✓',
  fail: '✗',
  running: '●',
  pending: '○',
  skipped: '·',
  error: '✗'
} as const
