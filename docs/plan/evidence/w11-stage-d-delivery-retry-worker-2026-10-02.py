"""在 API 容器运行：真实沙箱写出工作区外文件，注入一次项目副本失败，不补存、不调用模型。"""
import argparse
import asyncio
import json
from pathlib import Path
from app.infrastructure.storage.postgres import get_postgres, get_uow
from app.infrastructure.storage.redis import get_redis
from app.interfaces.service_dependencies import get_project_file_service
from app.domain.models.event import MessageEvent
from app.domain.models.run import RunStatus
from app.domain.services.run_ledger import RunLedger
from app.domain.services.project_file_coordinator import ProjectFileCoordinator
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox


async def main(args):
    await get_postgres().init()
    await get_redis().init()
    fs = get_project_file_service()
    ledger = RunLedger(get_uow)
    evidence = {'project_id': args.project_id, 'session_id': args.session_id, 'result': 'running'}
    output = Path(args.output)

    def save():
        output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2))

    sandbox = None
    try:
        run = await ledger.start(args.session_id, events_after=[MessageEvent(role='user', message='阶段 D 交付副本观察')])
        evidence['run_id'] = run.id
        save()
        await fs.prepare_run(args.project_id, args.session_id, run.id)
        sandbox = await DockerSandbox.create_owned(args.project_id, args.session_id, run.id)
        evidence['sandbox_id'] = sandbox.id
        save()
        await sandbox.ensure_sandbox()
        await sandbox.validate_project(args.project_id)
        expected = 'stage-d-delivery,1\n'
        written = await sandbox.write_file(filepath='/tmp/partial.csv', content=expected)
        assert written.success, written.message
        original = fs.delivery._persist

        async def fail(copy):
            raise OSError('观察注入：项目副本失败')

        fs.delivery._persist = fail
        partial = await fs.delivery.deliver(args.project_id, args.session_id, run.id, 'call-partial', '/tmp/partial.csv', sandbox)
        fs.delivery._persist = original
        assert partial.project['state'] == 'failed' and partial.file.id
        evidence['partial_file_id'] = partial.file.id
        evidence['partial_key'] = partial.project['copy_key']
        evidence['partial_error'] = partial.project.get('error')
        evidence['expected'] = expected
        save()
        await ledger.transition(args.session_id, run.id, RunStatus.COMPLETED)
        assert await ProjectFileCoordinator(get_uow, DockerSandbox, fs.measure_size).settle(args.project_id)
        await sandbox.destroy()
        sandbox = None
        evidence['result'] = 'failed_copy_ready_for_retry'
    except BaseException as exc:
        evidence['result'], evidence['error'] = 'failed', repr(exc)
        raise
    finally:
        if sandbox is not None:
            await sandbox.destroy()
        save()
        await get_postgres().shutdown()
        await get_redis().shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--session-id', required=True)
    parser.add_argument('--output', required=True)
    asyncio.run(main(parser.parse_args()))
