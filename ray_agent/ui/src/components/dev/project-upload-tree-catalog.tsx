'use client'

import {useState} from 'react'
import {ProjectUploadTree} from '@/components/project-upload-tree'
import type {UploadScan, ExcludedUpload} from '@/lib/project-upload'

// 合成资料与大小，未读取本地文件；只演示审核树，不调用上传接口。
const files = ['原始资料/source.csv', '报告/第一阶段/说明.txt', '报告/第二阶段/用于核对长中文文件名显示与详情展开的研究结果.md', ...Array.from({length: 20}, (_,i) => `报告/参考资料/资料-${i+1}.txt`)].map(path => ({path, file: {size:260} as File, sha256:'synthetic'}))
const excluded: ExcludedUpload[] = [
  {path:'.git',directory:true,policy:'always',reason:'版本库或系统文件',size:null},
  {path:'node_modules',directory:true,policy:'optional',reason:'依赖目录，确认后继续扫描',size:null},
  {path:'.env',directory:false,policy:'optional',reason:'可能包含密钥或凭据',size:28},
  {path:'超大材料.bin',directory:false,policy:'always',reason:'超过单文件大小上限',size:100000000},
]
export function ProjectUploadTreeCatalog() {
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set())
  const scan: UploadScan = {files: confirmed.has('.env') ? [...files,{path:'.env',file:{size:28} as File,sha256:'synthetic'}] : files, excluded:excluded.filter(item => !confirmed.has(item.path)), inventory:[],includeOptional:[...confirmed],errors:[]}
  const optionalRows = excluded.map(item => confirmed.has(item.path) ? {...item,size:item.directory ? 520 : 28,reason:'合成：已确认上传，可取消确认'} : item)
  return <div className="flex h-[560px] min-h-0 flex-col"><ProjectUploadTree scan={scan} optionalRows={optionalRows} confirmed={confirmed} overwrite={overwrite} preflight={null} result={null} sourceName="研究材料（合成）" disabled={false} onOptional={(path,checked) => setConfirmed(old => {const next=new Set(old);if(checked)next.add(path);else next.delete(path);return next})} onOverwrite={(path,checked) => setOverwrite(old => {const next=new Set(old);if(checked)next.add(path);else next.delete(path);return next})}/></div>
}
