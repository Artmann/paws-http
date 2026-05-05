import { Box, Text, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import React, { useMemo, useState } from 'react'
import { theme } from '../theme.js'
import type { DiscoveredFile } from '../discover.js'

interface Props {
  files: DiscoveredFile[]
  root: string
  onPick: (file: DiscoveredFile) => void
  onQuit: () => void
}

export function Picker({ files, root, onPick, onQuit }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return files
    return files.filter((f) => f.relPath.toLowerCase().includes(q))
  }, [files, query])

  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1))

  useInput((input, key) => {
    if (key.escape || (input === 'q' && !query)) {
      onQuit()
      return
    }
    if (key.upArrow) setCursor(Math.max(0, safeCursor - 1))
    else if (key.downArrow)
      setCursor(Math.min(filtered.length - 1, safeCursor + 1))
    else if (key.return && filtered[safeCursor]) onPick(filtered[safeCursor]!)
  })

  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 100
  const rows = stdout?.rows ?? 30
  const maxVisible = Math.max(6, rows - 10)

  const windowStart = Math.max(
    0,
    Math.min(
      safeCursor - Math.floor(maxVisible / 2),
      filtered.length - maxVisible
    )
  )
  const visible = filtered.slice(windowStart, windowStart + maxVisible)

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box>
        <Text
          color={theme.brand}
          bold
        >
          paws-http
        </Text>
        <Text color={theme.fgDim}> — pick a flow to run</Text>
      </Box>
      <Text color={theme.fgSubtle}>
        Found {files.length} .http files under {root}
      </Text>

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={theme.border}
        flexDirection="column"
      >
        <Box paddingX={1}>
          <Text color={theme.brand}>/ </Text>
          <TextInput
            value={query}
            onChange={(v) => {
              setQuery(v)
              setCursor(0)
            }}
            placeholder="fuzzy filter…"
          />
          <Box flexGrow={1} />
          <Text color={theme.fgSubtle}>
            {filtered.length}/{files.length}
          </Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.border}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
        >
          {visible.map((f, i) => {
            const realIndex = windowStart + i
            const selected = realIndex === safeCursor
            return (
              <Box key={f.path}>
                <Text color={selected ? theme.brand : theme.fgSubtle}>
                  {selected ? '❯ ' : '  '}
                </Text>
                <Text color={selected ? theme.fg : theme.fgDim}>
                  {truncate(f.relPath, Math.max(20, cols - 20))}
                </Text>
              </Box>
            )
          })}
          {filtered.length === 0 && (
            <Text color={theme.fgSubtle}> (no matches)</Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>↑↓ move ⏎ open / filter esc quit</Text>
      </Box>
    </Box>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return '…' + s.slice(-(max - 1))
}
