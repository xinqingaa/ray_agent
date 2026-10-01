"""API 容器的阶段 D 记忆核对。真实数据库/配置摘要模型；没有 Agent/浏览器验收。"""
import argparse
import asyncio
import json
from pathlib import Path
from app.infrastructure.storage.postgres import get_postgres, get_uow
from app.infrastructure.storage.redis import get_redis
from app.interfaces.service_dependencies import get_project_service, get_project_memory_service
from app.domain.services.run_ledger import RunLedger
from app.domain.services.project_file_coordinator import ProjectFileCoordinator
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox
from app.domain.services.prompts.project import snapshot_prompt
from app.domain.models.event import MessageEvent, DoneEvent
from app.domain.models.run import RunStatus


async def main(args):
    await get_postgres().init();await get_redis().init()
    service=get_project_service();memory=get_project_memory_service();ledger=RunLedger(get_uow)
    evidence=dict(project_id=args.project_id,session_id=args.session_id,
        kind='实际 API 容器服务/业务 PostgreSQL；独立真实摘要模型；没有 Agent 循环或浏览器',checks=[])
    path=Path(args.output)
    def save():path.write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    try:
        async def prepare(uow):
            s=await uow.session.get_by_id(args.session_id)
            await service.prepare_snapshot(uow,s)
            evidence['frozen_context']=s.project_snapshot.model_dump(mode='json')
        run=await ledger.start(args.session_id,before_start=prepare,
            events_after=[MessageEvent(role='user',message='统计三笔金额10、20、30，总计60元。')])
        evidence['run_id']=run.id;save()
        async with get_uow() as uow:
            s=await uow.session.get_by_id(args.session_id)
        frozen=snapshot_prompt(s.project_snapshot)
        project=await service.get(args.project_id)
        updated=await memory.update_notes(project.id,'统计口径：金额单位为元；总计60。',project.notes_version,
            session_id=args.session_id,run_id=run.id)
        evidence['notes_tool_service_result']=updated
        assert snapshot_prompt(s.project_snapshot)==frozen
        await ledger.append(args.session_id,[MessageEvent(role='assistant',message='三笔金额合计60元。')],run_id=run.id)
        await ledger.transition(args.session_id,run.id,RunStatus.COMPLETED,events_before=[DoneEvent()])
        await ProjectFileCoordinator(get_uow,DockerSandbox).settle(args.project_id)
        ticket=await memory.begin_summary(args.session_id)
        evidence['summary_request_material']=ticket['material'];save()
        await memory.generate_ticket(ticket)
        summary=await memory.get_summary(args.session_id)
        evidence['summary_result']=summary;save()
        assert summary['summary_state']=='ready',summary
        assert summary['summary_source']=='auto' and summary['summary_source_seq']==ticket['source_seq']
        second=await service.create_session(args.project_id);evidence['second_session_id']=second.id;save()
        async with get_uow() as uow:
            snapshot=await service.memory_snapshot(uow,second)
        assert snapshot.notes_version==updated['notes_version']
        assert snapshot.summaries[0]['session_id']==args.session_id
        assert summary['summary'] in snapshot.summaries[0]['injected_text']
        evidence['next_conversation_context']=snapshot.model_dump(mode='json')
        evidence['checks']=['冻结笔记不随写入变更','Agent服务笔记与项目审计同事务全文',
            '真实摘要模型生成并保存来源、代次和截止seq','下一段对话读取新版笔记与前段摘要']
        evidence['status']='passed';save()
    except BaseException as exc:
        evidence.update(status='failed',error=f'{type(exc).__name__}: {exc}');save();raise


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--project-id',required=True)
    parser.add_argument('--session-id',required=True);parser.add_argument('--output',required=True)
    asyncio.run(main(parser.parse_args()))
