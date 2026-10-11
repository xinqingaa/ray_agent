import type {FileInfo} from '@/lib/api/types'

export const isImageFile = (file: FileInfo) => file.mime_type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|tiff?|heic)$/i.test(file.filename)

/** items 与 files 是同一份数据的不同视图，只使用一套，避免重复上传。 */
export function clipboardImages(data: DataTransfer): File[] {
  const items = Array.from(data.items ?? [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter((file): file is File => file != null)
  const images = items.length ? items : Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'))
  return images.map(file => {
    if (/\.[a-z0-9]+$/i.test(file.name)) return file
    const extension = ({'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'} as Record<string, string>)[file.type] ?? 'img'
    return new File([file], `粘贴图片-${crypto.randomUUID()}.${extension}`, {type: file.type, lastModified: file.lastModified})
  })
}
