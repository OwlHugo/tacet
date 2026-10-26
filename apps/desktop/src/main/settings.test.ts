import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { choseWhisperModel, defaultSettings, loadSettings, saveSettings } from './settings.ts'

const NOT_PICKED = { whisperModel: false }
const file = () => join(mkdtempSync(join(tmpdir(), 'tacet-settings-')), 'settings.json')

describe('settings', () => {
  const defaults = defaultSettings('/docs', 'large-v3-turbo')

  it('uses the defaults before the first save and round-trips a save', () => {
    const f = file()
    expect(loadSettings(f, defaults)).toEqual(defaults)
    expect(defaults.whisperModel).toBe('large-v3-turbo')
    saveSettings(
      f,
      { ...defaults, llmModel: 'llama3.2', whisperModel: 'small' },
      defaults,
      NOT_PICKED,
    )
    expect(loadSettings(f, defaults)).toEqual({
      ...defaults,
      llmModel: 'llama3.2',
      whisperModel: 'small',
    })
  })

  it('writes only what differs from the defaults, so a better default model still applies', () => {
    const f = file()
    saveSettings(f, { ...defaults, language: 'pt' }, defaults, NOT_PICKED)
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
    saveSettings(f, { ...defaults, whisperModel: 'base' }, defaults, NOT_PICKED)
    expect(loadSettings(f, defaults).whisperModel).toBe('base')
  })

  it('keeps a model picked in a file from before version 2 when it equals the default', () => {
    const f = file()
    const small = defaultSettings('/docs', 'small')
    writeFileSync(f, JSON.stringify({ ...small, language: 'auto' }))
    expect(choseWhisperModel(f)).toBe(true)
    saveSettings(f, { ...small, language: 'pt' }, small, { whisperModel: choseWhisperModel(f) })
    expect(loadSettings(f, defaults).whisperModel).toBe('small')
    writeFileSync(f, JSON.stringify(defaultSettings('/docs', 'base')))
    expect(choseWhisperModel(f)).toBe(false)
  })

  it('keeps a model the user picked even when it is the default of the moment', () => {
    const f = file()
    const base = defaultSettings('/docs', 'base')
    expect(choseWhisperModel(f)).toBe(false)
    saveSettings(f, base, base, { whisperModel: true })
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ version: 2, whisperModel: 'base' })
    expect(choseWhisperModel(f)).toBe(true)
    // the turbo model is downloaded later: the pick stays
    expect(loadSettings(f, defaults).whisperModel).toBe('base')
    // a model never picked follows the best one downloaded
    const g = file()
    saveSettings(g, { ...base, language: 'pt' }, base, NOT_PICKED)
    expect(choseWhisperModel(g)).toBe(false)
    expect(loadSettings(g, defaults).whisperModel).toBe('large-v3-turbo')
  })

  it('ignores a settings file that no longer validates', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ whisperModel: 'gigantic' }))
    expect(loadSettings(f, defaults)).toEqual(defaults)
  })
})
