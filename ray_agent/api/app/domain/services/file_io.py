"""线程中的文件 IO：等待线程实际退出后再传播取消，调用方据此完成持久发布或清理。"""
import asyncio


async def _join_io(work):
    cancelled = False
    while True:
        try:
            return await asyncio.shield(work), cancelled
        except asyncio.CancelledError:
            cancelled = True
            if work.done():
                return work.result(), cancelled


async def run_file_io(function, *args, **kwargs):
    return await _join_io(asyncio.create_task(asyncio.to_thread(function, *args, **kwargs)))


async def run_async_io(awaitable):
    return await _join_io(asyncio.create_task(awaitable))
