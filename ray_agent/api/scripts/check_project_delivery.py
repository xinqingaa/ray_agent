"""在 API 容器运行：真实交付副本/路径边界/销毁沙箱后补存，无模型。"""
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
    fs = get_project_file_service(); ledger = RunLedger(get_uow)
    evidence = {'project_id': args.project_id, 'session_id': args.session_id,
        'kind': '真实 API 服务/业务 PostgreSQL/Docker 沙箱；无模型或浏览器操作', 'checks': []}
    output = Path(args.output)
    def save():
        output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    sandbox = None
    try:
        run = await ledger.start(args.session_id, events_after=[MessageEvent(role='user',message='阶段 D 交付副本观察')])
        evidence['run_id'] = run.id;save()
        await fs.prepare_run(args.project_id,args.session_id,run.id)
        sandbox = await DockerSandbox.create_owned(args.project_id,args.session_id,run.id)
        evidence['sandbox_id'] = sandbox.id;save()
        await sandbox.ensure_sandbox()
        await sandbox.validate_project(args.project_id)
        expected = '答案,42\n'
        for path in ('/tmp/report.csv','/tmp/partial.csv','/workspace/reference.csv'):
            result = await sandbox.write_file(filepath=path,content=expected)
            assert result.success,result.message
        command = "sudo mkdir -p /workspace-other && sudo chown ubuntu:ubuntu /workspace-other && cp /tmp/report.csv /workspace-other/report.csv && ln -sf /tmp/report.csv /workspace/link.csv"
        result = await sandbox.exec_command(session_id='delivery-check',exec_dir='/home/ubuntu',command=command)
        assert result.success,result.message
        for index,path in enumerate(('/tmp/report.csv','/workspace/reference.csv','/workspace-other/report.csv','/workspace/link.csv')):
            delivered = await fs.delivery.deliver(args.project_id,args.session_id,run.id,f'call-{index}',path,sandbox)
            assert delivered.project['state'] == ('in_workspace' if index == 1 else 'ready'),delivered
            repeated = await fs.delivery.deliver(args.project_id,args.session_id,run.id,f'call-{index}',path,sandbox)
            assert delivered.file.id == repeated.file.id
        evidence['checks'] += ['实际解析路径：工作区内不复制、workspace-other 与外部链接复制', '同 run/call/path 复用既有交付附件']
        original = fs.delivery._persist
        async def fail(copy):
            raise OSError('观察注入：项目副本失败')
        fs.delivery._persist = fail
        partial = await fs.delivery.deliver(args.project_id,args.session_id,run.id,'call-partial','/tmp/partial.csv',sandbox)
        assert partial.project['state'] == 'failed' and partial.file.id
        fs.delivery._persist = original
        evidence['partial_file_id'],evidence['partial_key'] = partial.file.id,partial.project['copy_key'];save()
        await ledger.transition(args.session_id,run.id,RunStatus.COMPLETED)
        assert await ProjectFileCoordinator(get_uow,DockerSandbox,fs.measure_size).settle(args.project_id)
        await sandbox.destroy();sandbox = None
        saved = await fs.delivery.retry(args.project_id,partial.project['copy_key'])
        assert saved['state'] == 'ready'
        assert (await fs.delivery.retry(args.project_id,partial.project['copy_key'])) == saved
        data,_ = await fs.delivery.file_storage.download_file(partial.file.id)
        try:
            assert data.read() == expected.encode()
        finally:
            data.close()
        evidence['checks'] += ['部分失败保留会话附件', '旧写入者停止和测试沙箱销毁', '无沙箱补存、相同附件 id、重复补存幂等']
        async with get_uow() as uow:
            copies = await uow.project.file_copies(args.project_id)
            files = [await uow.file.get_by_id(c.attachment_id) for c in copies]
        evidence['copies'] = [c.model_dump(mode='json') for c in copies]
        evidence['files'] = [f.model_dump(mode='json') for f in files]
        evidence['expected_bytes_hex'] = expected.encode().hex()
        evidence['result'] = 'passed'
    except BaseException as exc:
        evidence['result'],evidence['error'] = 'failed',repr(exc)
        raise
    finally:
        if sandbox is not None:
            await sandbox.destroy()
        save()
        await get_postgres().shutdown()
        await get_redis().shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-id',required=True)
    parser.add_argument('--session-id',required=True)
    parser.add_argument('--output',required=True)
    asyncio.run(main(parser.parse_args()))
