#!/usr/bin/env node
/** 写入 public/build-manifest.json：只哈希界面源与构建输入，不读凭据。 */
import {createHash} from 'node:crypto'
import {execSync} from 'node:child_process'
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const inputs = ['src', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json']

function* files(base) {
  const full = join(root, base)
  let info
  try {
    info = statSync(full)
  } catch {
    return
  }
  if (info.isFile()) {
    yield full
    return
  }
  for (const name of readdirSync(full)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    yield* files(join(base, name))
  }
}

const digest = createHash('sha256')
const collected = []
for (const input of inputs) {
  for (const path of files(input)) {
    if (!statSync(path).isFile()) continue
    collected.push(path)
  }
}
collected.sort((a, b) => relative(root, a).localeCompare(relative(root, b)))
for (const path of collected) {
  const rel = relative(root, path).split('\\').join('/')
  const content = createHash('sha256').update(readFileSync(path)).digest('hex')
  digest.update(`${rel}\0${content}\n`)
}

let revision = process.env.BUILD_REVISION || null
let dirty = process.env.BUILD_DIRTY ?? null
if (revision == null) {
  try {
    revision = execSync('git rev-parse HEAD', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim()
    dirty = execSync('git status --porcelain', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}).toString().length > 0
  } catch {
    /* 无 git 时保留空 */
  }
}

const manifest = {
  service: 'ui',
  algorithm: 'sha256-path-content-v1',
  fingerprint: digest.digest('hex'),
  revision,
  dirty: dirty === 'true' || dirty === true ? true : dirty === 'false' || dirty === false ? false : dirty,
  built_at: new Date().toISOString(),
}

const out = join(root, 'public', 'build-manifest.json')
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
process.stdout.write(`wrote ${out}\n`)
