/* eslint-disable @typescript-eslint/no-require-imports */
// Same sha256-path-content-v1 format as the API, with UI-specific input scope.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {execFileSync} = require('node:child_process')
const root = path.resolve(__dirname, '..')
const inputs = ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'Dockerfile', '.dockerignore', 'scripts/build-identity.cjs']
function fingerprint(base = root) {
  const files = []
  function visit(rel) {
    if (rel === 'public/build-manifest.json') return
    const target = path.join(base, rel)
    if (!fs.existsSync(target)) return
    if (fs.statSync(target).isDirectory()) for (const name of fs.readdirSync(target)) visit(`${rel}/${name}`)
    else files.push(rel)
  }
  inputs.forEach(visit)
  const digest = crypto.createHash('sha256')
  for (const rel of files.sort()) digest.update(`${rel}\0${crypto.createHash('sha256').update(fs.readFileSync(path.join(base, rel))).digest('hex')}\n`)
  // This public value is compiled into the UI; credentials and other environment values are excluded.
  digest.update(`@NEXT_PUBLIC_API_BASE_URL\0${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8088/api'}\n`)
  return digest.digest('hex')
}
function manifest() {
  let revision = process.env.BUILD_REVISION || null, dirty = process.env.BUILD_DIRTY || null
  if (!revision) try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim()
    dirty = String(!!execFileSync('git', ['status', '--porcelain'], {cwd: root}).toString())
  } catch {}
  return {service: 'ui', algorithm: 'sha256-path-content-v1', fingerprint: fingerprint(), revision,
    dirty: dirty === null ? null : dirty === 'true', built_at: new Date().toISOString()}
}
module.exports = {fingerprint, manifest}
if (require.main === module) {
  require('@next/env').loadEnvConfig(root, false, {info() {}, error() {}})
  const data = JSON.stringify(manifest(), null, 2) + '\n'
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'public/build-manifest.json'), data)
  else process.stdout.write(data)
}
