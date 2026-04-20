#!/usr/bin/env bun
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { discoverHttpFiles } from './discover'
import { findEnvFiles, listEnvironments, resolveEnv } from './env'
import { ParseError } from './parser/types'
import { parseHttpFile } from './parser/parser'
import {
  printFlowStart,
  printFlowSummary,
  printStepReport
} from './reporter/console'
import { runFlow } from './runner/runner'

interface CliArgs {
  command: 'run' | 'env' | 'default'
  path?: string
  env?: string
  failFast: boolean
  onlyStep?: string
  subcommand?: string
  subArg?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: 'default', failFast: false }
  if (argv.length === 0) return args
  const [head, ...rest] = argv
  if (head === 'run') {
    args.command = 'run'
  } else if (head === 'env') {
    args.command = 'env'
    args.subcommand = rest.shift()
    args.subArg = rest.shift()
    return args
  } else if (head === '--help' || head === '-h') {
    printHelp()
    process.exit(0)
  } else if (head?.startsWith('-')) {
    printHelp()
    process.exit(1)
  } else {
    // Treat bare path as `run <path>`.
    args.command = 'run'
    args.path = head
  }

  const queue = args.command === 'run' ? rest : rest
  while (queue.length > 0) {
    const arg = queue.shift()!
    if (arg === '-e' || arg === '--env') {
      args.env = queue.shift()
    } else if (arg === '-f' || arg === '--fail-fast') {
      args.failFast = true
    } else if (arg === '--only') {
      args.onlyStep = queue.shift()
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (!arg.startsWith('-') && !args.path) {
      args.path = arg
    } else {
      console.error(`pawsh: unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`pawsh — interactive HTTP flow runner

Usage:
  pawsh                         browse files interactively
  pawsh run <file.http>         run a single .http flow
  pawsh run <dir>               run every .http in a directory
  pawsh run <file> --only 1.3   run a single step
  pawsh env list                list environments in nearest env.json
  pawsh env use <name>          set default environment

Flags:
  -e, --env <name>             environment (default: local)
  -f, --fail-fast              stop on first failed step
      --only <step-num>        run only step with this num (e.g. 1.2)
  -h, --help                   show this help
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === 'default') {
    await runInteractive(undefined)
    return
  }

  if (args.command === 'env') {
    if (args.subcommand === 'list') {
      const files = await findEnvFiles(
        args.subArg
          ? resolve(args.subArg)
          : resolve(process.cwd(), 'dummy.http')
      )
      const envs = listEnvironments(files)
      if (envs.length === 0) {
        console.log('(no http-client.env.json found)')
      } else {
        for (const name of envs) console.log(name)
      }
      return
    }
    console.error('pawsh: unknown env subcommand')
    process.exit(1)
  }

  // command === 'run'
  if (!args.path) {
    console.error('pawsh run: need a file or directory')
    process.exit(1)
  }
  const target = resolve(args.path)

  const interactive = process.stdout.isTTY && !process.env.CI
  if (interactive && args.path) {
    await runInteractive(target, args)
    return
  }
  await runNonInteractive(target, args)
}

async function runNonInteractive(target: string, args: CliArgs): Promise<void> {
  const files = await discoverHttpFiles(target)
  if (files.length === 0) {
    console.error(`pawsh: no .http files under ${target}`)
    process.exit(1)
  }

  let totalFailed = 0

  for (const file of files) {
    const source = await readFile(file.path, 'utf-8')
    let flow
    try {
      flow = parseHttpFile(file.path, source)
    } catch (err) {
      if (err instanceof ParseError) {
        console.error(err.message)
      } else {
        console.error(`pawsh: failed to parse ${file.path}: ${String(err)}`)
      }
      totalFailed += 1
      continue
    }

    const envFiles = await findEnvFiles(file.path)
    const envName = args.env ?? pickDefaultEnv(envFiles) ?? 'local'
    const env = resolveEnv(envFiles, envName)

    printFlowStart(file.path, envName)
    const report = await runFlow(flow, {
      env,
      failFast: args.failFast,
      onlySteps: args.onlyStep ? new Set([args.onlyStep]) : undefined,
      onEvent: (ev) => {
        if (ev.kind === 'step:done') printStepReport(ev.report)
      }
    })
    printFlowSummary(report)
    if (report.status !== 'pass') totalFailed += 1
  }

  process.exit(totalFailed > 0 ? 1 : 0)
}

async function runInteractive(
  target: string | undefined,
  args: CliArgs = { command: 'run', failFast: false }
): Promise<void> {
  // Lazy-import Ink so non-interactive runs don't pull in React.
  const { startInteractive } = await import('./ui/App')
  await startInteractive(target, args)
}

function pickDefaultEnv(files: {
  publicEnv: Record<string, unknown>
  privateEnv: Record<string, unknown>
}): string | undefined {
  const all = new Set([
    ...Object.keys(files.publicEnv),
    ...Object.keys(files.privateEnv)
  ])
  if (all.has('local')) return 'local'
  return [...all][0]
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
