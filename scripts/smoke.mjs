// End-to-end smoke test: builds must already exist in dist/ (`npm run build`).
// Serves dist/, boots the game in headless Chromium, flies, swoops, switches magpie, walks the
// menus, fails on any console error, and writes screenshots to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out'), 120_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 30_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    for (const selector of ['.logo-text', '.tagline']) {
      const family = getComputedStyle(document.querySelector(selector)).fontFamily
      if (!family.startsWith('"ManusCC0"') && !family.startsWith('ManusCC0,')) throw new Error(`Unexpected game font: ${family}`)
    }
  })
  await page.waitForTimeout(1200)
  return page
}

const state = page => page.evaluate(() => {
  const { game } = window.__game
  const b = game.bird
  return { mode: game.mode, run: game.run, active: game.active, birdMode: b.mode, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, people: game.crowd.people.length, audio: game['audio'].ctx.state }
})

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []
  const en = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(en, errors)
  await page.screenshot({ path: `${out}/01-title.png` })
  await page.click('[data-action="play"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  const before = await state(page)
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(800)
  await page.keyboard.up('KeyD')
  await page.keyboard.press('Space')
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/02-flight.png` })
  const after = await state(page)
  const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)
  if (after.mode !== 'playing') throw new Error(`expected playing, got ${after.mode}`)
  if (!(after.run.timeLeft < before.run.timeLeft)) throw new Error('clock did not run')
  if (moved < 6) throw new Error(`magpie barely moved (${moved.toFixed(2)} m)`)
  if (after.people < 3) throw new Error(`expected people in the park, got ${after.people}`)
  if (after.audio !== 'running') throw new Error(`audio context is ${after.audio}`)
  console.log(`smoke: flew ${moved.toFixed(1)} m, ${after.people} people, clock ${after.run.timeLeft.toFixed(1)} s`)

  // Swoop: put the bird behind the nearest person, aim at them and dive through the real controller.
  await page.evaluate(() => {
    const { game } = window.__game
    const p = game.crowd.people.find(q => q.alive)
    const b = game.bird
    const yaw = p.yaw ?? 0
    b.pos.set(p.aim.x + Math.sin(yaw) * 9, p.aim.y + 4, p.aim.z + Math.cos(yaw) * 9)
    b.yaw = Math.atan2(-(p.aim.x - b.pos.x), -(p.aim.z - b.pos.z))
    b.pitch = -0.3
    b.prev.copy(b.pos)
  })
  await page.keyboard.press('KeyF')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${out}/03-swoop.png` })
  await page.waitForTimeout(1200)
  const swooped = await state(page)
  if (swooped.run.scares + swooped.run.hits < 1) throw new Error('swoop did not scare or hit anyone')
  console.log(`smoke: swoop scored ${swooped.run.score} (scares ${swooped.run.scares}, hits ${swooped.run.hits})`)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(300)
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(1200)
  const switched = await state(page)
  if (switched.active !== 2) throw new Error(`expected magpie 3 active, got ${switched.active + 1}`)
  if (!(switched.run.carolCooldown > 0)) throw new Error('carol did not start')
  await page.screenshot({ path: `${out}/04-switched.png` })

  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/05-pause.png` })
  await page.click('[data-screen="pause"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/06-settings.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(300)
  if ((await state(page)).mode !== 'paused') throw new Error('leaving Settings with Escape resumed the run')
  // Results: run the season clock out through the real rules.
  await page.evaluate(() => {
    const { game } = window.__game
    game.resume()
    for (let i = 0; i < 20 && game.mode === 'playing'; i += 1) {
      game.run = { ...game.run, timeLeft: Math.min(game.run.timeLeft, 0.05) }
      game.step(1 / 60)
    }
  })
  await page.waitForSelector('[data-screen="results"].is-active', { timeout: 10_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/07-results.png` })
  const done = await state(page)
  if (done.run.phase !== 'won') throw new Error(`expected a won season, got ${done.run.phase}`)
  await en.close()

  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-AU' })
  const phonePage = await openGame(phone, errors)
  await phonePage.tap('[data-action="play"]')
  await phonePage.waitForSelector('[data-screen="hud"].is-active')
  await phonePage.waitForTimeout(1500)
  await phonePage.screenshot({ path: `${out}/08-phone-hud.png` })
  await phone.close()
  if (errors.length) throw new Error(`console errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — screenshots in ${out}/`)
} catch (err) {
  await fail(err?.message ?? String(err))
}
