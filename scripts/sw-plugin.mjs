// Vite plugin: after the build is written, generate dist/sw.js from scripts/sw-template.js with
// the exact list of files to precache and a version derived from their contents.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const INCLUDE = [/^index\.html$/, /^manifest\.webmanifest$/, /^assets\//, /^fonts\/.*\.(ttf|woff2?)$/, /^icons\//]
const EXCLUDE = [/^assets\/share\//, /\.map$/]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export function serviceWorker() {
  let outDir = 'dist'
  return {
    name: 'magswoop-service-worker',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir },
    closeBundle() {
      const files = walk(outDir)
        .map(p => ({ p, rel: relative(outDir, p).split(sep).join('/') }))
        .filter(f => INCLUDE.some(r => r.test(f.rel)) && !EXCLUDE.some(r => r.test(f.rel)))
        .sort((a, b) => a.rel.localeCompare(b.rel))
      const h = createHash('sha256')
      for (const f of files) h.update(f.rel).update(readFileSync(f.p))
      const version = h.digest('hex').slice(0, 12)
      const assets = files.map(f => (f.rel === 'index.html' ? './' : `./${f.rel}`))
      const src = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replace("const VERSION = '__VERSION__'", `const VERSION = '${version}'`)
        .replace('const ASSETS = __ASSETS__', `const ASSETS = ${JSON.stringify(assets)}`)
      if (src.includes("'__VERSION__'") || src.includes('= __ASSETS__')) throw new Error('[sw] template placeholders not replaced')
      writeFileSync(join(outDir, 'sw.js'), src)
      console.log(`[sw] ${assets.length} files precached, version ${version}`)
    },
  }
}
