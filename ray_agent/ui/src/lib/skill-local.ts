/** 设置页本地 Skill 材料：文件夹、ZIP、单个 Markdown，或 Markdown 加文本。 */

export type LocalFile = {path: string; file: File}
export type ClassifiedLocal =
  | {ok: false; error: string}
  | {ok: true; zip: true; path: string}
  | {ok: true; zip: false; files: {from: string; path: string}[]; skillFrom: string | null}

const ignored = (path: string) => path.split('/').some(part => part === '.DS_Store' || part === '__MACOSX')
const vendor = (path: string) => path.split('/').some(part => part === '.git' || part === 'node_modules')

export function classifyLocalPaths(paths: string[], mode: 'loose' | 'folder'): ClassifiedLocal {
  const visible = paths
    .map(raw => ({raw, path: raw.normalize('NFC')}))
    .filter(item => item.path && !ignored(item.path))
  if (visible.some(item => vendor(item.path))) return {ok: false, error: '请选择 Skill 目录，不要包含 .git 或 node_modules'}
  if (!visible.length) return {ok: false, error: '没有可导入的文件'}
  const seen = new Set<string>()
  for (const item of visible) {
    if (item.path.includes('\\') || item.path.startsWith('/') || item.path.split('/').some(part => part === '.' || part === '..')) return {ok: false, error: `非法路径：${item.path}`}
    const key = item.path.toLowerCase()
    if (seen.has(key)) return {ok: false, error: `重复路径：${item.path}`}
    seen.add(key)
  }
  if (mode === 'folder') return {ok: true, zip: false, files: visible.map(item => ({from: item.raw, path: item.path})), skillFrom: null}
  const zips = visible.filter(item => !item.path.includes('/') && item.path.toLowerCase().endsWith('.zip'))
  if (zips.length === 1 && visible.length === 1) return {ok: true, zip: true, path: zips[0].raw}
  if (zips.length) return {ok: false, error: '请只上传一个 ZIP，或改为选择文件夹'}
  if (visible.some(item => !item.path.toLowerCase().endsWith('.md') && !item.path.toLowerCase().endsWith('.txt'))) return {ok: false, error: '请选择 Markdown、文本、一个 ZIP，或改用文件夹'}
  const markdown = visible.filter(item => item.path.toLowerCase().endsWith('.md'))
  const skill = visible.find(item => item.path === 'SKILL.md')
  if (skill && markdown.some(item => item.path !== 'SKILL.md')) return {ok: false, error: '请只保留一个 SKILL.md；其他 Markdown 请放入文件夹或 ZIP'}
  if (!skill && markdown.length > 1) return {ok: false, error: '请保留一个名为 SKILL.md 的文件'}
  if (!markdown.length) return {ok: false, error: '请提供 SKILL.md'}
  const skillFrom = (skill ?? markdown[0]).raw
  return {ok: true, zip: false, files: visible.map(item => ({from: item.raw, path: item.raw === skillFrom && item.path !== 'SKILL.md' ? 'SKILL.md' : item.path})), skillFrom}
}

export function hasSkillFrontmatter(text: string) {
  return /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(text.replace(/^\uFEFF/, ''))
}

export function skillDocument(name: string, description: string, body: string) {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${body.endsWith('\n') ? body : `${body}\n`}`
}

export function folderSkillFiles(files: File[]): LocalFile[] {
  return files.map(file => {
    const path = file.webkitRelativePath.split('/').slice(1).join('/').normalize('NFC')
    if (!path) throw new Error('无法读取文件夹中的路径')
    return {path, file}
  })
}

type Entry = {name: string; isFile: boolean; isDirectory: boolean; file?: (ok: (file: File) => void, err: (error: DOMException) => void) => void; createReader?: () => {readEntries(ok: (entries: Entry[]) => void, err: (error: DOMException) => void): void}}

function readEntry(entry: Entry, prefix: string): Promise<LocalFile[]> {
  if (entry.isFile) return new Promise((resolve, reject) => entry.file!(file => resolve([{path: prefix ? `${prefix}/${entry.name}` : entry.name, file}]), reject))
  const reader = entry.createReader!()
  const children: Entry[] = []
  const read = () => new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
  return (async () => {
    for (;;) {
      const batch = await read()
      if (!batch.length) break
      children.push(...batch)
    }
    const nested = await Promise.all(children.map(child => readEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name)))
    return nested.flat()
  })()
}

export async function filesFromDrop(items: DataTransferItemList): Promise<{mode: 'loose' | 'folder'; files: LocalFile[]}> {
  const collected: {entry: Entry | null; file: File | null}[] = []
  for (const item of Array.from(items)) {
    const entry = (item as DataTransferItem & {webkitGetAsEntry?: () => Entry | null}).webkitGetAsEntry?.() ?? null
    collected.push({entry, file: entry ? null : item.getAsFile()})
  }
  const directories = collected.filter(item => item.entry?.isDirectory)
  const loose = collected.filter(item => item.entry?.isFile || (!item.entry && item.file))
  if (directories.length && loose.length) throw new Error('请只选择一种材料')
  if (directories.length > 1) throw new Error('请选择一个 Skill 目录')
  if (directories.length === 1) {
    const root = directories[0].entry!
    const reader = root.createReader!()
    const children: Entry[] = []
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      children.push(...batch)
    }
    const groups = await Promise.all(children.map(child => readEntry(child, '')))
    const files = groups.flat()
    if (!files.length) throw new Error('没有可导入的文件')
    return {mode: 'folder', files}
  }
  const files: LocalFile[] = []
  for (const item of loose) {
    if (item.entry?.isFile) files.push(...await readEntry(item.entry, ''))
    else if (item.file) files.push({path: item.file.name, file: item.file})
  }
  if (!files.length) throw new Error('没有可导入的文件')
  return {mode: 'loose', files}
}

export function localImportForm(operationId: string, files: {path: string; file: Blob}[], unpackZip: boolean, update?: {update_name: string; expected_version: string}) {
  const data = new FormData()
  data.set('operation_id', operationId)
  data.set('unpack_zip', unpackZip ? '1' : '0')
  for (const item of files) {
    data.append('paths', item.path)
    data.append('files', item.file, item.path.split('/').pop() || 'file')
  }
  if (update?.update_name) data.set('update_name', update.update_name)
  if (update?.expected_version) data.set('expected_version', update.expected_version)
  return data
}
