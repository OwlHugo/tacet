import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
    saveSettings(f, { ...defaults, llmModel: 'llama3.2', whisperModel: 'small' }, defaults)
    expect(loadSettings(f, defaults)).toEqual({
      ...defaults,
      llmModel: 'llama3.2',
      whisperModel: 'small',
    })
  })

  it('writes only what differs from the defaults, so a better default model still applies', () => {
    const f = file()
    saveSettings(f, { ...defaults, language: 'pt' }, defaults)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ version: 2, language: 'pt' })
    const base = defaultSettings('/docs', 'base')
    expect(loadSettings(f, base)).toEqual({ ...base, language: 'pt' })
  })

  it('ignores the model in a file from before version 2, where it was the old default written back', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ ...defaultSettings('/docs', 'base'), language: 'pt' }))
    expect(loadSettings(f, defaults)).toEqual({ ...defaults, language: 'pt' })
    writeFileSync(f, JSON.stringify({ ...defaultSettings('/docs', 'small'), language: 'pt' }))
    expect(loadSettings(f, defaults)).toEqual({
      ...defaults,
      whisperModel: 'small',
      language: 'pt',
    })
    saveSettings(f, { ...defaults, whisperModel: 'base' }, defaults)
    expect(loadSettings(f, defaults).whisperModel).toBe('base')
  })

  it('ignores a settings file that no longer validates', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ whisperModel: 'gigantic' }))
    expect(loadSettings(f, defaults)).toEqual(defaults)
  })
})
