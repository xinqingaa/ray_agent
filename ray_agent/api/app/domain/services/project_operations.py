"""短事务登记、按 operation_id 释放；耗时 IO 由调用方持有所有权完成。"""
from datetime import datetime
from app.domain.models.project_operation import ProjectOperation
from app.domain.services.project_transactions import ProjectRunConflict


def require_writable(project):
    if project.file_operation:
        op = project.file_operation
        reason = '恢复未完成，请先修复' if op.kind == 'restore' and op.state == 'failed' else '项目文件操作尚未结束'
        raise ProjectRunConflict(f'{reason}（{op.kind}/{op.state}）：{op.error or op.phase}', op.session_id, operation=op, project_id=project.id)


async def claim(uow, project_id, kind, **values):
    project = await uow.project.get(project_id, lock=True)
    if project is None:
        raise ProjectRunConflict('项目不存在')
    require_writable(project)
    occupied = await uow.run.get_active_project(project_id)
    if occupied and not (kind == 'snapshot' and values.get('run_id') == occupied.id):
        raise ProjectRunConflict('项目仍有活动运行，请先回复或停止', occupied.session_id)
    if project.archived_at and kind != 'cleanup':
        raise ProjectRunConflict('项目已归档，请先恢复')
    operation = ProjectOperation(kind=kind, **values)
    project.file_operation = operation
    await uow.project.save(project)
    await uow.project.audit(project_id, "file_operation", operation.model_dump(mode="json"))
    return operation


async def mark_settling(uow, project, run_id, session_id):
    if project.file_operation:
        # 运行前 snapshot 占用在终态时保留；线程退出后才能转入 settling。
        return
    project.file_operation = ProjectOperation(kind='settling', run_id=run_id,
        session_id=session_id, phase='stopping_writers')
    await uow.project.save(project)
    await uow.project.audit(project.id, "file_operation", project.file_operation.model_dump(mode="json"))


async def finish(uow, project_id, operation_id, *, error=None):
    project = await uow.project.get(project_id, lock=True)
    if project is None or project.file_operation is None or project.file_operation.operation_id != operation_id:
        return False
    payload = project.file_operation.model_dump(mode="json")
    payload.update(result="failed" if error else "completed", error=error, ended_at=datetime.now().isoformat())
    if error:
        project.file_operation.state = 'failed'
        project.file_operation.error = error
        project.file_operation.last_active_at = datetime.now()
    else:
        project.file_operation = None
    await uow.project.save(project)
    await uow.project.audit(project_id, "file_operation", payload)
    return True


async def owned(uow, project_id, operation_id):
    project = await uow.project.get(project_id, lock=True)
    if project is None or project.file_operation is None or project.file_operation.operation_id != operation_id:
        raise ProjectRunConflict('文件操作所有权已经改变，请读回最新结果')
    return project
