import type {RootEntry, WorkspaceItem} from '@/lib/api/types'
import type {TreeState} from '@/lib/workspace-tree'

export const menuWorkspace: WorkspaceItem = {
  id: 'menu-workspace',
  name: '资料整理',
  status: 'active',
  version: 1,
  folder: {root_id: 'menu-root', path: '/示例/资料整理', status: 'available', marker_writable: true, checked_at: null},
  write_lease: null,
  local_execution_enabled: false,
  auto_memory_enabled: true,
  instruction_version: null,
  instruction_preview: null,
  created_at: 0,
  updated_at: 0,
}

function entry(relative_path: string, kind: RootEntry['kind']): RootEntry {
  return {path: {root_id: 'menu-root', relative_path}, name: relative_path.split('/').at(-1)!, kind,
    size: kind === 'file' ? 640 : null, modified_at: null, modified_ns: null, link_target: kind === 'symlink' ? '资料' : null}
}

export const menuFolderTree: TreeState = {
  expanded: ['资料', '待核对'],
  directories: {
    '': {status: 'ready', entries: [entry('资料', 'directory'), entry('待核对', 'directory'), entry('资料快捷方式', 'symlink')], truncated: false},
    '资料': {status: 'ready', entries: [entry('资料/说明.md', 'file')], truncated: false},
    '待核对': {status: 'error', entries: [], truncated: false, message: '读取目录失败'},
  },
}
