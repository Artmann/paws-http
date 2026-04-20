import { stat } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface DiscoveredFile {
  path: string
  /** Path relative to the search root, for display. */
  relPath: string
}

export async function discoverHttpFiles(
  root: string
): Promise<DiscoveredFile[]> {
  const info = await stat(root)
  if (info.isFile()) {
    return [{ path: root, relPath: root }]
  }
  const out: DiscoveredFile[] = []
  await walk(root, root, out)
  return out
}

async function walk(
  root: string,
  dir: string,
  out: DiscoveredFile[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, full, out)
    } else if (entry.isFile() && entry.name.endsWith('.http')) {
      out.push({
        path: full,
        relPath: full.slice(root.length + 1) || entry.name
      })
    }
  }
}
