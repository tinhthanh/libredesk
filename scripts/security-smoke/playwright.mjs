// Finds a Playwright install: PLAYWRIGHT_DIR (a folder with node_modules/@playwright/test), else
// the frontend's, else the omnichannel omi-admin web's (both repos sit side by side on the box).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = [
  process.env.PLAYWRIGHT_DIR,
  path.join(here, '../../frontend'),
  path.join(here, '../../../omnichannel/omi-admin/web')
].filter(Boolean)

export async function chromium() {
  for (const dir of candidates) {
    try {
      const req = createRequire(path.join(dir, 'package.json'))
      const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href)
      return pw.chromium ?? pw.default.chromium
    } catch {
      // next
    }
  }
  throw new Error(`no Playwright found in ${candidates.join(', ')} (set PLAYWRIGHT_DIR)`)
}

export const frontend = path.join(here, '../../frontend')
export const exists = (p) => fs.existsSync(p)
