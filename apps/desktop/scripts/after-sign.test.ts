import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import afterSign from './after-sign.ts'

// Built like the hook builds it, so the test holds on Windows too.
const APP = join('/out/mac-arm64', 'Tacet.app')

const context = (platform: string) => ({
  electronPlatformName: platform,
  appOutDir: '/out/mac-arm64',
  packager: {
    appInfo: { productFilename: 'Tacet', id: 'dev.tacet.app' },
    info: { projectDir: '/repo/apps/desktop' },
  },
})

function fakeCodesign(signature: string) {
  const calls: (readonly string[])[] = []
  const run = (args: readonly string[]) => {
    calls.push(args)
    return args[0] === '-dv' ? `Identifier=dev.tacet.app\nSignature=${signature}\n` : ''
  }
  return { calls, run }
}

describe('afterSign', () => {
  it('does nothing outside macOS', () => {
    const f = fakeCodesign('adhoc')
    for (const p of ['win32', 'linux']) afterSign(context(p), f.run)
    expect(f.calls).toEqual([])
  })

  it('leaves a Developer ID signature alone', () => {
    const f = fakeCodesign('size=9000')
    afterSign(context('darwin'), f.run)
    expect(f.calls).toEqual([['-dv', APP]])
  })

  it('pins an ad-hoc signature to the bundle id so macOS keeps permissions across builds', () => {
    const f = fakeCodesign('adhoc')
    afterSign(context('darwin'), f.run)
    expect(f.calls[1]).toEqual([
      '--force',
      '--sign',
      '-',
      '--identifier',
      'dev.tacet.app',
      '--options',
      'runtime',
      '--entitlements',
      join('/repo/apps/desktop', 'build', 'entitlements.mac.plist'),
      '-r=designated => identifier "dev.tacet.app"',
      APP,
    ])
  })
})
