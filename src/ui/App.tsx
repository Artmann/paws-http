import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Box, render, Text, useApp } from 'ink'
import React, { useEffect, useState } from 'react'
import { discoverHttpFiles, type DiscoveredFile } from '../discover.js'
import { findEnvFiles, resolveEnv, type ResolvedEnv } from '../env.js'
import { parseHttpFile } from '../parser/parser.js'
import type { Flow } from '../parser/types.js'
import { Launcher } from './Launcher.js'
import { RunScreen } from './RunScreen.js'

interface CliArgs {
  env?: string
  failFast: boolean
  onlyStep?: string
}

export interface LoadedFile {
  file: DiscoveredFile
  flow: Flow
}

type Screen =
  | { kind: 'launcher' }
  | {
      kind: 'run'
      files: LoadedFile[]
      initialIndex: number
      resolveEnvFor: (path: string, envName: string) => Promise<ResolvedEnv>
      root: string
    }
  | { kind: 'error'; message: string }

export async function startInteractive(
  target: string | undefined,
  args: CliArgs
): Promise<void> {
  let initial: Screen
  if (!target) {
    initial = { kind: 'launcher' }
  } else {
    try {
      initial = await buildRunScreen(target, args)
    } catch (err) {
      initial = {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }

  const app = render(
    <App
      initial={initial}
      args={args}
    />
  )
  await app.waitUntilExit()
}

async function buildRunScreen(target: string, _args: CliArgs): Promise<Screen> {
  const abs = resolve(target)
  const info = await stat(abs)
  const files = await discoverHttpFiles(abs)
  if (files.length === 0) {
    return { kind: 'error', message: `No .http files under ${abs}` }
  }

  const loaded: LoadedFile[] = []
  for (const file of files) {
    try {
      const source = await readFile(file.path, 'utf-8')
      loaded.push({ file, flow: parseHttpFile(file.path, source) })
    } catch (err) {
      // Still expose the file, just with an empty flow so the TUI can show
      // the error rather than crash on startup.
      loaded.push({
        file,
        flow: {
          filePath: file.path,
          steps: [],
          warnings: [
            {
              line: 0,
              message: err instanceof Error ? err.message : String(err)
            }
          ]
        }
      })
    }
  }

  const root = info.isFile() ? resolve(abs, '..') : abs

  let initialIndex = 0
  if (info.isFile()) {
    const idx = loaded.findIndex((l) => l.file.path === abs)
    if (idx >= 0) initialIndex = idx
  }

  const resolveEnvFor = async (path: string, envName: string) => {
    const envFiles = await findEnvFiles(path)
    return resolveEnv(envFiles, envName)
  }

  return { kind: 'run', files: loaded, initialIndex, resolveEnvFor, root }
}

function App({ initial, args }: { initial: Screen; args: CliArgs }) {
  const [screen, setScreen] = useState<Screen>(initial)
  const { exit } = useApp()

  const onBrowse = async () => {
    try {
      setScreen(await buildRunScreen(process.cwd(), args))
    } catch (err) {
      setScreen({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  useEffect(() => {
    // No auto-navigation — launcher stays until the user picks an action.
  }, [])

  if (screen.kind === 'error') {
    return (
      <Box padding={1}>
        <Text color="red">pawsh: {screen.message}</Text>
      </Box>
    )
  }

  if (screen.kind === 'launcher') {
    return (
      <Launcher
        onBrowse={onBrowse}
        onQuit={exit}
      />
    )
  }

  return (
    <RunScreen
      files={screen.files}
      initialIndex={screen.initialIndex}
      resolveEnvFor={screen.resolveEnvFor}
      root={screen.root}
      envName={args.env}
      failFast={args.failFast}
      onlyStep={args.onlyStep}
      onQuit={exit}
    />
  )
}
