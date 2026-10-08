"""回收已登记、所属运行已结束且到期的临时图；永久附件不进入此路径。"""
import logging
import time

from app.domain.models.run import ACTIVE_RUN_STATUSES

logger = logging.getLogger(__name__)


async def expire_visual_artifacts(uow_factory, storage, now=None):
    now = time.time() if now is None else now
    async with uow_factory() as uow:
        candidates = await uow.file.expired_visual_files(now)
    deleted = []
    for file in candidates:
        async with uow_factory() as uow:
            run = await uow.run.get(file.visual['run_id'])
        if run is not None and run.status in ACTIVE_RUN_STATUSES:
            continue
        try:
            await storage.delete_visual_file(file)
            file.visual = {**file.visual, 'deleted_at': now}
            async with uow_factory() as uow:
                await uow.file.save(file)
            deleted.append(file.id)
        except Exception:
            logger.exception('临时图回收失败 file=%s；保留记录以便重试', file.id)
    return deleted
