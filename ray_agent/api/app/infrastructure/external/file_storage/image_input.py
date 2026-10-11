"""用户附件的有界图片编码；原文件保留，模型副本按引用确定性重建。"""
import hashlib
import io
import warnings

from PIL import Image, ImageOps

MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_SOURCE_PIXELS = 40_000_000
MAX_MODEL_BYTES = 2 * 1024 * 1024
MAX_MODEL_EDGE = 2048
MAX_MESSAGE_IMAGES = 2
FORMATS = {'PNG', 'JPEG', 'WEBP', 'GIF'}


def is_image_attachment(file) -> bool:
    return file.mime_type.lower().startswith('image/') or file.extension.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.tif', '.tiff', '.heic'}


def encode_image(data: bytes) -> tuple[bytes, dict]:
    """只取静态首帧，校验实际格式与像素数后缩放，输出无元数据的 JPEG。"""
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError('用于看图的原图最多 20 MiB，请缩小图片或仅作为文件发送')
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data)) as original:
                if original.format not in FORMATS:
                    raise ValueError('看图支持 PNG、JPEG、WebP 和 GIF 首帧；其他格式请仅作为文件发送')
                if original.width * original.height > MAX_SOURCE_PIXELS:
                    raise ValueError('原图超过 4000 万像素，请缩小图片或仅作为文件发送')
                frames = getattr(original, 'n_frames', 1)
                original.seek(0)
                image = ImageOps.exif_transpose(original).convert('RGBA')
                image.thumbnail((MAX_MODEL_EDGE, MAX_MODEL_EDGE), Image.Resampling.LANCZOS)
                background = Image.new('RGB', image.size, 'white')
                background.paste(image, mask=image.getchannel('A'))
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValueError('图片尺寸过大，请缩小图片或仅作为文件发送') from exc
        except (OSError, SyntaxError) as exc:
            raise ValueError('无法读取图片，请重新上传有效图片或仅作为文件发送') from exc
    for _ in range(6):
        output = io.BytesIO()
        background.save(output, format='JPEG', quality=90, optimize=False)
        encoded = output.getvalue()
        if len(encoded) <= MAX_MODEL_BYTES:
            return encoded, dict(width=background.width, height=background.height,
                mime_type='image/jpeg', size=len(encoded), sha256=hashlib.sha256(encoded).hexdigest(),
                original_sha256=hashlib.sha256(data).hexdigest(), frames=frames,
                token_estimate=max(1024, ((background.width + 511) // 512) * ((background.height + 511) // 512) * 256))
        background = background.resize((max(1, background.width * 3 // 4), max(1, background.height * 3 // 4)), Image.Resampling.LANCZOS)
    raise ValueError('图片无法缩小到模型输入上限，请缩小图片或仅作为文件发送')


def read_image(stream) -> tuple[bytes, dict]:
    return encode_image(stream.read(MAX_SOURCE_BYTES + 1))
