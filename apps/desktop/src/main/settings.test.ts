import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, saveSettings } from './settings.ts'

const file = () => join(mkdtempSync(join(tmpdir(), 'tacet-settings-')), 'settings.json')

describe('settings', () => {
  const defaults = defaultSettings('/docs', 'large-v3-turbo')

  it('uses the defaults before the first save and round-trips a save', () => {
    const f = file()
    expect(loadSettings(f, defaults)).toEqual(defaults)
    expect(defaults.whisperModel).toBe('large-v3-turbo')
    saveSettings(f, { ...defaults, llmModel: 'llama3.2' })
    expect(loadSettings(f, defaults).llmModel).toBe('llama3.2')
  })

  it('ignores a settings file that no longer validates', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ whisperModel: 'gigantic' }))
    expect(loadSettings(f, defaults)).toEqual(defaults)
  })
})
