import type {ProjectUploadRules, ProjectUploadSelection} from '@/lib/api/types'

export type UploadSource = {
  name: string; kind: 'file' | 'directory'; knownSize?: number; file?: () => Promise<File>;
  children?: () => Promise<UploadSource[]>; hasMarker?: (name: string) => Promise<boolean>;
}
export type ScanFile = {path: string; file: File; sha256: string}
export type ExcludedUpload = {path: string; reason: string; policy: 'always' | 'optional'; size: number | null; directory: boolean}
export type UploadScan = {files: ScanFile[]; excluded: ExcludedUpload[]; inventory: string[]; includeOptional: string[]; errors: string[]}

function glob(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`).test(name)
}
function safeName(name: string): string {
  const value = name.normalize('NFC')
  if (!value || value === '.' || value === '..' || /[\/\\\x00-\x1f\x7f]/.test(value)) throw new Error(`文件名不可上传：${name}`)
  return value
}
export function classifyUpload(name: string, directory: boolean, siblingNames: string[], rule: ProjectUploadRules, marker = false) {
  if (rule.always_exclude.includes(name)) return {policy: 'always' as const, reason: '版本库或系统文件'}
  if (directory && (rule.dependency_directories.includes(name) || marker ||
      (rule.conditional_directories[name] || []).some(pattern => siblingNames.some(sibling => glob(sibling, pattern))))) {
    return {policy: 'optional' as const, reason: '依赖或构建目录；清单文件仍会保留'}
  }
  if (!directory && rule.sensitive_patterns.some(pattern => glob(name.toLowerCase(), pattern))) {
    return {policy: 'optional' as const, reason: '可能包含密钥或凭据'}
  }
  return {policy: 'include' as const, reason: ''}
}

/** 只枚举当前层名称，先判断排除再进入子目录；可选目录勾选后才遍历文件和统计大小。 */
export async function scanProjectUpload(roots: UploadSource[], rule: ProjectUploadRules, confirmed: Set<string>,
  onProgress?: (path: string) => void, cancelled?: () => boolean): Promise<UploadScan> {
  const output: UploadScan = {files: [], excluded: [], inventory: [], includeOptional: [...confirmed], errors: []}
  const seen = new Set<string>()
  const check = () => {if (cancelled?.()) throw new DOMException('扫描已取消', 'AbortError')}
  async function visit(sources: UploadSource[], prefix: string, inherited = false) {
    check()
    const names = sources.map(source => safeName(source.name))
    for (const name of names) output.inventory.push(prefix + name)
    if (output.inventory.length > 10000) throw new Error('扫描清单超过10000项，请减少所选材料后重新扫描')
    for (let index = 0; index < sources.length; index++) {
      check()
      const source = sources[index], name = names[index], path = prefix + name
      onProgress?.(path)
      if (source.kind === 'directory') {
        let decision = classifyUpload(name, true, names, rule)
        // 确定排除不用进目录；必要的 venv 标志查询只取元数据，不扫描依赖文件。
        if (decision.policy === 'include' && source.hasMarker && await source.hasMarker(rule.venv_marker)) {
          output.inventory.push(`${path}/${rule.venv_marker}`)
          decision = classifyUpload(name, true, names, rule, true)
        }
        if (decision.policy === 'always' || (decision.policy === 'optional' && !confirmed.has(path) && !inherited)) {
          output.excluded.push({path, ...decision, size: source.knownSize ?? null, directory: true}); continue
        }
        if (!source.children) throw new Error(`浏览器无法扫描目录：${path}`)
        await visit(await source.children(), path + '/', inherited || confirmed.has(path))
        continue
      }
      if (!source.file) throw new Error(`浏览器无法读取文件：${path}`)
      const file = await source.file()
      const decision = classifyUpload(name, false, names, rule)
      if (decision.policy === 'always' || (decision.policy === 'optional' && !confirmed.has(path))) {
        output.excluded.push({path, ...decision, size: file.size, directory: false}); continue
      }
      if (file.size > rule.max_file_bytes) {
        output.excluded.push({path, policy: 'always', reason: '超过单文件大小上限', size: file.size, directory: false}); continue
      }
      if (seen.has(path)) {output.errors.push(`重复的规范化路径：${path}`); continue}
      seen.add(path)
      if (output.files.length >= rule.max_files || output.files.reduce((sum,item) => sum + item.file.size, 0) + file.size > rule.max_batch_bytes) {
        output.errors.push('最终待上传集合超过单次文件数量或大小上限，请减少所选文件');
        // 继续枚举元数据以列出所有排除项，不再读取超限内容。
        continue
      }
      if (!globalThis.crypto?.subtle) throw new Error('当前浏览器环境无法安全计算文件哈希，请用 localhost 或 HTTPS 打开')
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('')
      check(); output.files.push({path, file, sha256})
    }
  }
  await visit(roots, '')
  return output
}

export function uploadSelection(scan: UploadScan, rule: ProjectUploadRules, overwrite = new Set<string>(), only?: Set<string>): ProjectUploadSelection {
  return {rule_version: rule.version, items: scan.files.filter(item => !only || only.has(item.path)).map(item => ({path: item.path,
    size: item.file.size, sha256: item.sha256, overwrite: overwrite.has(item.path)})),
    include_optional: scan.includeOptional, inventory: scan.inventory, fingerprint: {}}
}

type DirectoryHandle = {name: string; kind: 'directory'; values(): AsyncIterable<FileHandle | DirectoryHandle>; getFileHandle(name: string): Promise<FileHandle>}
type FileHandle = {name: string; kind: 'file'; getFile(): Promise<File>}
function handleSource(handle: FileHandle | DirectoryHandle): UploadSource {
  return handle.kind === 'file' ? {name: handle.name, kind: 'file', file: () => handle.getFile()} : {
    name: handle.name, kind: 'directory', children: async () => {
      const result: UploadSource[] = []; for await (const child of handle.values()) result.push(handleSource(child)); return result
    }, hasMarker: async name => {try {await handle.getFileHandle(name); return true} catch (error) {
      if (error instanceof DOMException && ['NotFoundError','TypeMismatchError'].includes(error.name)) return false; throw error
    }},
  }
}
export async function chooseProjectFolder(): Promise<{name: string; sources: UploadSource[]} | null> {
  const picker = (window as unknown as {showDirectoryPicker?: () => Promise<DirectoryHandle>}).showDirectoryPicker
  if (!picker) return null
  const directory = await picker.call(window)
  const sources: UploadSource[] = []; for await (const handle of directory.values()) sources.push(handleSource(handle))
  return {name: directory.name, sources}
}

/** webkitdirectory 已经枚举全部文件；只在支持入口不足时使用，并在选择前提示这一限制。 */
export function sourcesFromFiles(files: File[], stripRoot = false): UploadSource[] {
  type Branch = {name: string; files: Map<string, Branch | File>}
  const root: Branch = {name: '', files: new Map()}
  for (const file of files) {
    const full = (file.webkitRelativePath || file.name).split('/')
    const parts = stripRoot && full.length > 1 ? full.slice(1) : full
    let branch = root
    for (const name of parts.slice(0,-1)) {
      const old = branch.files.get(name)
      if (old instanceof File) throw new Error(`文件与目录路径冲突：${name}`)
      const next = old || {name, files: new Map()}; branch.files.set(name,next); branch=next
    }
    const leaf=parts[parts.length-1]
    if (branch.files.has(leaf)) throw new Error(`重复文件路径：${parts.join('/')}`)
    branch.files.set(leaf,file)
  }
  const bytes = (branch: Branch): number => [...branch.files.values()].reduce((sum,value) => sum + (value instanceof File ? value.size : bytes(value)),0)
  const children = (branch: Branch): UploadSource[] => [...branch.files.entries()].map(([name,value]) => value instanceof File
    ? {name,kind:'file',file: async () => value}
    : {name,kind:'directory',knownSize:bytes(value),children: async () => children(value),hasMarker: async marker => value.files.get(marker) instanceof File})
  return children(root)
}

type WebEntry = {name: string; isFile: boolean; isDirectory: boolean; file?(done: (file: File) => void, fail: (error: DOMException) => void): void; createReader?(): {readEntries(done: (entries: WebEntry[]) => void, fail: (error: DOMException) => void): void}; getFile?(path: string, options: {create: false}, done: (entry: WebEntry) => void, fail: (error: DOMException) => void): void}
function entrySource(entry: WebEntry): UploadSource {
  return entry.isFile ? {name:entry.name,kind:'file',file: () => new Promise((resolve,reject) => entry.file!(resolve,reject))} : {
    name:entry.name,kind:'directory',children: async () => {
      const reader=entry.createReader!(), result: UploadSource[]=[]
      while (true) {const batch=await new Promise<WebEntry[]>((resolve,reject) => reader.readEntries(resolve,reject)); if (!batch.length) break; result.push(...batch.map(entrySource))}
      return result
    },hasMarker: name => new Promise((resolve,reject) => entry.getFile!(name,{create:false},() => resolve(true),error => {
      if (['NotFoundError','TypeMismatchError'].includes(error.name)) resolve(false); else reject(error)
    })),
  }
}
export function sourcesFromDrop(items: DataTransferItemList): UploadSource[] {
  const result: UploadSource[]=[]
  for (const item of Array.from(items)) {
    const entry=(item as unknown as {webkitGetAsEntry?: () => WebEntry | null}).webkitGetAsEntry?.()
    if (entry) result.push(entrySource(entry))
    else {const file=item.getAsFile(); if (file) result.push({name:file.name,kind:'file',file:async () => file})}
  }
  return result
}
