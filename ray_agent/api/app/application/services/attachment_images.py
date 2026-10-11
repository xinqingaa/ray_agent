"""按实际模型能力准备像素，不能直接输入的图片保留为文件工具材料。"""
import asyncio

from app.application.errors.exceptions import BadRequestError
from app.infrastructure.external.file_storage.image_input import is_image_attachment, read_image, MAX_MESSAGE_IMAGES


async def prepare_attachment_images(storage, event, session_id, supports_vision):
    event.image_input_note = None
    images = [file for file in event.attachments if is_image_attachment(file)]
    if not images or event.image_mode == 'files':
        return []
    if not supports_vision:
        event.image_input_note = '本次模型请求未提供图片像素，图片原文件可通过附件路径处理。请自行选择工具读取或识别；无法分析时说明实际限制，不能仅凭文件名描述图片内容。'
        return []
    if len(images) > MAX_MESSAGE_IMAGES:
        event.image_input_note = '图片数量超过本次像素输入预算，所有图片均作为原文件提供，未输入像素。请按附件路径自行选择工具处理，不能声称已直接看过图片。'
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
        event.image_input_note = '\n'.join(notes) + '\n请自行选择工具处理未提供像素的附件，并依据实际读取结果回答。'
    return refs
