"""按实际模型能力准备像素，保留原文件并说明未输入像素的实际原因。"""
import asyncio

from app.application.errors.exceptions import BadRequestError
from app.infrastructure.external.file_storage.image_input import is_image_attachment, read_image, MAX_MESSAGE_IMAGES


async def prepare_attachment_images(storage, event, session_id, supports_vision):
    event.image_input_note = None
    images = [file for file in event.attachments if is_image_attachment(file)]
    if not images:
        return []
    if not supports_vision:
        event.image_input_note = '当前运行未启用模型原生视觉能力，本次模型请求未提供图片像素。原文件已作为附件提供；普通识图请求应直接说明当前模型无法直接看图，建议切换支持视觉的模型，不尝试工具识图。'
        return []
    if event.image_mode == 'files':
        event.image_input_note = '当前运行已启用模型原生视觉能力，但本条消息使用仅文件模式，只提供附件路径，未提供图片像素。需要直接看图时请以自动图片输入方式重新发送。'
        return []
    if len(images) > MAX_MESSAGE_IMAGES:
        event.image_input_note = f'当前运行已启用模型原生视觉能力，但图片数量超过本次像素输入预算，所有图片均作为原文件提供，未输入像素。需要直接看图时请每条消息最多发送 {MAX_MESSAGE_IMAGES} 张图片。'
        return []
    refs = []
    notes = []
    for file in images:
        stream = None
        try:
            stream, _ = await storage.download_file(file.id)
            _, metadata = await asyncio.to_thread(read_image, stream)
        except ValueError as exc:
            notes.append(f'附件「{file.filename}」未生成像素输入（{exc}），原文件仍通过附件路径提供。')
            continue
        except Exception as exc:
            raise BadRequestError(f'图片「{file.filename}」读取失败，请重新上传后发送') from exc
        finally:
            if stream is not None:
                stream.close()
        refs.append(dict(metadata, source='user_attachment', file_id=file.id, session_id=session_id,
            filename=file.filename, purpose='用户提供的图片材料', temporary=False, detail='high'))
    if notes:
        event.image_input_note = '当前运行已启用模型原生视觉能力。\n' + '\n'.join(notes) + '\n请说明对应图片的输入限制，建议重新提供支持的图片；不能声称已看过未提供像素的附件。'
    return refs
