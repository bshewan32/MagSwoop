import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { carol, createRun, formatClock, loseEgg, scorePerson, stars, tick } from '../src/game/rules'

describe('run rules', () => {
  it('scores scares and hits, cyclists worth more', () => {
    const a = scorePerson(createRun(), 'runner', 'scare')
    expect(a.points).toBe(CONFIG.score.scareRunner)
    const b = scorePerson(createRun(), 'cyclist', 'hit')
    expect(b.points).toBe(CONFIG.score.hitCyclist)
    expect(b.state.hits).toBe(1)
    expect(b.state.cyclists).toBe(1)
    expect(a.state.scares).toBe(1)
  })
  it('builds a combo inside the window and resets it after', () => {
    let s = scorePerson(createRun(), 'runner', 'scare').state
    const second = scorePerson(s, 'runner', 'scare')
    expect(second.points).toBe(CONFIG.score.scareRunner * 2)
    s = tick(second.state, CONFIG.score.comboWindow + 0.1)
    expect(s.combo).toBe(0)
    expect(scorePerson(s, 'runner', 'scare').points).toBe(CONFIG.score.scareRunner)
  })
  it('caps the combo', () => {
    let s = createRun()
    for (let i = 0; i < 10; i += 1) s = scorePerson(s, 'runner', 'scare').state
    expect(s.combo).toBe(CONFIG.score.comboMax)
    expect(s.bestCombo).toBe(CONFIG.score.comboMax)
  })
  it('adds the defend bonus for intruders in the nest zone', () => {
    const r = scorePerson(createRun(), 'runner', 'scare', true)
    expect(r.points).toBe(CONFIG.score.scareRunner + CONFIG.score.defendBonus)
    expect(r.state.defended).toBe(1)
  })
  it('the carol buff multiplies points and then needs to recharge', () => {
    const c = carol(createRun())
    expect(c.ok).toBe(true)
    expect(scorePerson(c.state, 'runner', 'scare').points).toBe(Math.round(CONFIG.score.scareRunner * CONFIG.score.carolMultiplier))
    expect(carol(c.state).ok).toBe(false)
    const later = tick(c.state, CONFIG.carol.cooldown + 0.01)
    expect(later.carolTime).toBe(0)
    expect(carol(later).ok).toBe(true)
  })
  it('loses when every egg is taken', () => {
    let s = scorePerson(createRun(), 'runner', 'scare').state
    s = loseEgg(s)
    expect(s.eggs).toBe(CONFIG.run.eggs - 1)
    expect(s.combo).toBe(0)
    for (let i = 0; i < CONFIG.run.eggs; i += 1) s = loseEgg(s)
    expect(s.eggs).toBe(0)
    expect(s.phase).toBe('lost')
    expect(stars(s)).toBe(0)
    expect(scorePerson(s, 'runner', 'hit').points).toBe(0)
  })
  it('wins the season at the end of the clock with an egg bonus', () => {
    let s = scorePerson(createRun(), 'cyclist', 'hit').state
    s = tick(s, CONFIG.run.seconds + 1)
    expect(s.phase).toBe('won')
    expect(s.eggBonus).toBe(CONFIG.run.eggs * CONFIG.score.eggBonus)
    expect(s.score).toBe(CONFIG.score.hitCyclist + s.eggBonus)
    expect(stars(s)).toBe(2)
    expect(stars({ ...s, score: CONFIG.score.starScore })).toBe(3)
    expect(stars({ ...s, eggs: 1 })).toBe(1)
  })
  it('formats the clock', () => {
    expect(formatClock(150)).toBe('2:30')
    expect(formatClock(9.2)).toBe('0:10')
    expect(formatClock(-3)).toBe('0:00')
  })
})
