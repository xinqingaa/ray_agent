// 生成契约：先由 API 从 Pydantic 导出 JSON，再由锁定版本的生成器得到 TypeScript 类型。
// npm run generate 写入 generated/；npm run check 重新生成并比对，任何文件过期时退出码为 1。
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import openapiTS, {astToString} from 'openapi-typescript'
import {compile} from 'json-schema-to-typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const generated = path.join(root, 'generated')
const check = process.argv.includes('--check')
const banner = (source) => `/* 由 ray_agent/contracts 从 ${source} 生成，勿手改；改 Pydantic 契约后运行 npm run generate。 */\n`

function exportJson() {
  const args = ['run', '--locked', 'python', 'scripts/contracts.py', ...(check ? ['--check'] : [])]
  try {
    execFileSync('uv', args, {cwd: path.join(root, '..', 'api'), stdio: 'inherit'})
  } catch {
    process.exit(1)
  }
}

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(generated, name), 'utf8'))

async function fromJsonSchema(name) {
  const schema = readJson(name)
  return compile(schema, schema.title, {
    bannerComment: banner(name).trimEnd(),
    additionalProperties: false,
    unreachableDefinitions: true,
    format: true,
    cwd: generated,
  })
}

async function fromOpenApi(name) {
  return banner(name) + astToString(await openapiTS(readJson(name)))
}

exportJson()
const outputs = {
  'openapi.ts': await fromOpenApi('openapi.json'),
  'events.ts': await fromJsonSchema('events.schema.json'),
  'core.ts': await fromJsonSchema('core.schema.json'),
}

const outdated = Object.entries(outputs)
  .filter(([name, text]) => !fs.existsSync(path.join(generated, name)) || fs.readFileSync(path.join(generated, name), 'utf8') !== text)
  .map(([name]) => name)
const extra = fs.readdirSync(generated).filter((name) => name.endsWith('.ts') && !(name in outputs))

if (check) {
  if (outdated.length || extra.length) {
    console.error(`TypeScript 契约已过期：${[...outdated, ...extra].join('、')}；运行 npm run generate 后提交生成结果`)
    process.exit(1)
  }
  console.log('TypeScript 契约与 JSON 契约一致')
} else {
  for (const name of extra) fs.rmSync(path.join(generated, name))
  for (const [name, text] of Object.entries(outputs)) fs.writeFileSync(path.join(generated, name), text)
  console.log(`已写入 ${Object.keys(outputs).length} 个 TypeScript 契约文件`)
}
