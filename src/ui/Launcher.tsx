import { Box, Text, useInput } from 'ink'
import React from 'react'
import { theme } from '../theme'
import { Kbd } from './primitives'

interface Props {
  onBrowse: () => void
  onQuit: () => void
}

export function Launcher({ onBrowse, onQuit }: Props) {
  useInput((input, key) => {
    if (key.return || input === 'b') onBrowse()
    if (input === 'q' || key.escape) onQuit()
  })

  const lines: Array<[string, string?]> = [
    ['pawsh — interactive HTTP flow runner   v0.1.0', theme.brand],
    ['Run Rider / IntelliJ .http flows from the terminal.', theme.fgSubtle],
    [''],
    ['Usage:', theme.fgDim],
    ['  pawsh                         browse files interactively'],
    ['  pawsh run <file.http>         run a single .http flow'],
    ['  pawsh run <dir>               run every .http in a directory'],
    ['  pawsh run <file> --only 1.3   run a single step'],
    ['  pawsh env list                list environments'],
    [''],
    ['Flags:', theme.fgDim],
    ['  -e, --env <name>     environment (dev · staging · local · mock)'],
    ['  -f, --fail-fast      stop on first failed step'],
    [''],
    ['Shortcuts once running:', theme.fgDim],
    ['  ↑ ↓  move · ⏎ open · ⇥ switch pane · , . cycle files'],
    ['  s  run step  ·  r  run file  ·  a  run all files  ·  q  quit']
  ]

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text
          color={theme.brand}
          bold
        >
          pawsh{' '}
        </Text>
        <Text color={theme.fgSubtle}>terminal HTTP flow runner</Text>
      </Box>
      {lines.map(([text, color], i) => (
        <Text
          key={i}
          color={color ?? theme.fg}
        >
          {text || ' '}
        </Text>
      ))}
      <Box marginTop={1}>
        <Kbd
          k="↵"
          label="browse flows"
        />
        <Text color={theme.fgSubtle}> </Text>
        <Kbd
          k="q"
          label="quit"
        />
      </Box>
    </Box>
  )
}
