/**
 * electron-builder afterSign hook (macOS). An ad-hoc signature's designated requirement is the
 * cdhash, which changes on every build, so macOS forgets the Microphone and Screen Recording
 * grants after each rebuild. Re-sealing the outer bundle with a requirement on the bundle id
 * keeps the grants across local builds. Builds signed with a Developer ID are left alone.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

interface AfterSignContext {
  readonly electronPlatformName: string
  readonly appOutDir: string
  readonly packager: {
    readonly appInfo: { readonly productFilename: string; readonly id: string }
    readonly info: { readonly projectDir: string }
  }
}

/** Runs codesign and returns stdout + stderr (codesign -dv writes to stderr). */
export type Codesign = (args: readonly string[]) => string

const codesign: Codesign = (args) => {
  const r = spawnSync('codesign', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`codesign ${args.join(' ')} failed: ${r.stderr}`)
  return `${r.stdout}${r.stderr}`
}

export default function afterSign(context: AfterSignContext, run: Codesign = codesign): void {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!run(['-dv', app]).includes('Signature=adhoc')) return
  const id = context.packager.appInfo.id
  run([
    '--force',
    '--sign',
    '-',
    '--identifier',
    id,
    '--options',
    'runtime',
    '--entitlements',
    join(context.packager.info.projectDir, 'build', 'entitlements.mac.plist'),
    `-r=designated => identifier "${id}"`,
    app,
  ])
  console.log(`  • ad-hoc signature pinned to identifier ${id}`)
}
