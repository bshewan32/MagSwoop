import uiSrc from '../src/ui/ui.ts?raw'
import gameSrc from '../src/game/game.ts?raw'
import magpieSrc from '../src/game/magpies.ts?raw'
import { describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'
import { resolveLocale } from '../src/engine/i18n'

const dict = en as Record<string, string>

describe('i18n', () => {
  it('is English only', () => {
    expect(resolveLocale()).toBe('en')
    expect(Object.keys(import.meta.glob('../src/i18n/*.json'))).toEqual(['../src/i18n/en.json'])
  })
  it('defines every key used in the UI and game', () => {
    const sources = [uiSrc, gameSrc, magpieSrc].join('\n')
    const used = new Set<string>()
    for (const m of sources.matchAll(/data-i18n(?:-label|-placeholder)?="([\w.]+)"/g)) used.add(m[1])
    for (const m of sources.matchAll(/\b(?:t|banner)\('([\w.]+)'/g)) used.add(m[1])
    for (const m of sources.matchAll(/nameKey: '([\w.]+)'/g)) used.add(m[1])
    for (const key of used) expect(dict[key], key).toBeTypeOf('string')
    for (let i = 0; i < 12; i += 1) expect(dict[`shout.${i}`]).toBeTypeOf('string')
    for (const hint of ['fly', 'swoop', 'call', 'switch']) for (const m of ['keyboard', 'gamepad', 'touch']) expect(dict[`hint.${hint}.${m}`], `${hint}.${m}`).toBeTypeOf('string')
  })
})
