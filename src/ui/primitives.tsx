import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'
import { methodColor, statusIcon, theme } from '../theme.js'
import type { StepStatus } from '../runner/types.js'

export function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'pass':
      return <Text color={theme.green}>{statusIcon.pass}</Text>
    case 'fail':
    case 'error':
      return <Text color={theme.red}>{statusIcon.fail}</Text>
    case 'running':
      return (
        <Text color={theme.brand}>
          <Spinner type="dots" />
        </Text>
      )
    case 'skipped':
      return <Text color={theme.fgSubtle}>{statusIcon.skipped}</Text>
    default:
      return <Text color={theme.fgSubtle}>{statusIcon.pending}</Text>
  }
}

export function MethodBadge({ method }: { method: string }) {
  const color = methodColor[method] ?? theme.fgDim
  return (
    <Text
      color={color}
      bold
    >
      {method.padEnd(6)}
    </Text>
  )
}

export function Duration({ ms, running }: { ms?: number; running?: boolean }) {
  if (running) return <Text color={theme.brand}>…</Text>
  if (ms === undefined || ms === null)
    return <Text color={theme.fgSubtle}>—</Text>
  const text = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
  return <Text color={theme.fgSubtle}>{text}</Text>
}

export function Kbd({ k, label }: { k: string; label: string }) {
  return (
    <Box>
      <Text
        backgroundColor={theme.border}
        color={theme.fgDim}
      >
        {' '}
        {k}{' '}
      </Text>
      <Text color={theme.fgDim}> {label}</Text>
    </Box>
  )
}

export function ProgressBar({
  value,
  total,
  width,
  variant = 'brand'
}: {
  value: number
  total: number
  width: number
  variant?: 'brand' | 'success' | 'fail'
}) {
  const color =
    variant === 'success'
      ? theme.green
      : variant === 'fail'
        ? theme.red
        : theme.brand
  const safeWidth = Math.max(0, Math.floor(width) || 0)
  const pct = total <= 0 ? 0 : Math.min(1, Math.max(0, value / total))
  const filled = Math.max(0, Math.round(pct * safeWidth))
  const empty = Math.max(0, safeWidth - filled)
  return (
    <Box>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color={theme.border}>{'░'.repeat(empty)}</Text>
    </Box>
  )
}
