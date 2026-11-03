/**
 * Architecture boundaries, checked in CI. No dependencies: reads the imports of each file.
 *
 *   core pure features   transcript, minutes, matching, meeting   no Node I/O, no adapter
 *   core adapters        whisper, ollama, audio, library          may use Node; never the apps
 *   core                 never imports an app
 *   apps                 any package, never another app
 *   desktop renderer     never Node built-ins nor the Node entry of core (it runs in a browser)
 *
 * Also fails on import cycles between files.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const NODE_IO =
  /^node:(fs|net|http|https|child_process|worker_threads|dgram|dns|tls|os|stream)(\/|$)/

interface Rule {
  readonly from: RegExp
  readonly allowed: (target: string, resolved: string | undefined) => boolean
  readonly reason: string
}

const ADAPTERS = /^packages\/core\/src\/(whisper|ollama|audio|library)\//

const RULES: readonly Rule[] = [
  {
    from: /^packages\/core\/src\/(transcript|minutes|matching|meeting)\//,
    allowed: (t, r) => !NODE_IO.test(t) && !(r && ADAPTERS.test(r)),
    reason: 'pure core features do no I/O and do not depend on adapters',
  },
  {
    from: /^packages\/core\//,
    allowed: (t) => !t.startsWith('@tacet/desktop') && t !== '@hugoowl/tacet',
    reason: 'the core never imports an app',
  },
  {
    from: /^apps\/cli\//,
    allowed: (t) => !t.startsWith('@tacet/desktop'),
    reason: 'apps do not import other apps',
  },
  {
    from: /^apps\/desktop\/src\/renderer\//,
    allowed: (t, r) =>
      !t.startsWith('node:') &&
      t !== '@tacet/core' &&
      !(r && /\/(main|preload)\//.test(r) && !r.endsWith('.d.ts')),
    reason: 'the renderer runs in a browser: no Node, no core Node entry, no main-process code',
  },
  {
    from: /^apps\/desktop\//,
    allowed: (t) => t !== '@hugoowl/tacet',
    reason: 'apps do not import other apps',
  },
]

const SOURCE = /\.(ts|tsx)$/

async function list(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { recursive: true, withFileTypes: true })
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        SOURCE.test(e.name) &&
        !/\.test\.tsx?$/.test(e.name) &&
        !e.name.endsWith('.d.ts'),
    )
    .map((e) => relative(ROOT, join(e.parentPath, e.name)))
    .filter((f) => f.includes('/src/') && !f.includes('node_modules'))
}

const importsOf = (code: string): string[] =>
  [
    ...code.matchAll(
      /^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm,
    ),
  ]
    .map((m) => m[1] ?? m[2])
    .filter((x): x is string => x !== undefined)

const files = [...(await list('packages')), ...(await list('apps'))]
const graph = new Map<string, string[]>()
const violations: string[] = []

for (const file of files) {
  const rule = RULES.filter((r) => r.from.test(file))
  const local: string[] = []
  for (const target of importsOf(await readFile(join(ROOT, file), 'utf8'))) {
    const resolved = target.startsWith('.')
      ? relative(ROOT, resolve(ROOT, dirname(file), target))
      : undefined
    if (resolved && SOURCE.test(resolved)) local.push(resolved)
    for (const r of rule)
      if (!r.allowed(target, resolved)) violations.push(`${file} → ${target}: ${r.reason}`)
  }
  graph.set(file, local)
}

// Cycles: depth-first search with three colours.
const colour = new Map<string, 'grey' | 'black'>()
const visit = (node: string, path: readonly string[]): void => {
  if (colour.get(node) === 'black') return
  if (colour.get(node) === 'grey') {
    violations.push(`cycle: ${[...path.slice(path.indexOf(node)), node].join(' → ')}`)
    return
  }
  colour.set(node, 'grey')
  for (const next of graph.get(node) ?? []) visit(next, [...path, node])
  colour.set(node, 'black')
}
for (const node of graph.keys()) visit(node, [])

if (violations.length > 0) {
  for (const v of violations) console.error(`✗ ${v}`)
  process.exitCode = 1
} else {
  const edges = [...graph.values()].reduce((s, v) => s + v.length, 0)
  console.log(`arquitetura ok · ${files.length} files · ${edges} local imports · 0 cycles`)
}
