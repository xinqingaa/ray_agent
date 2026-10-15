from contextlib import asynccontextmanager
from sqlalchemy import select, text, delete
from app.infrastructure.models.skill import SkillRecord, SkillVersion, SkillImport, RunSkill

TABLES = {'skills': SkillRecord, 'versions': SkillVersion, 'imports': SkillImport}


class DBSkillTransaction:
    def __init__(self, session):
        self.session = session

    async def lock(self):
        await self.session.execute(text("SELECT pg_advisory_xact_lock(727941503)"))

    async def get(self, table, key):
        row = await self.session.get(TABLES[table], key)
        return dict(row.data) if row else None

    async def all(self, table):
        return [dict(r.data) for r in (await self.session.scalars(select(TABLES[table]))).all()]

    async def put(self, table, key, value):
        model = TABLES[table]
        row = await self.session.get(model, key)
        if row:
            row.data = dict(value)
        else:
            self.session.add(model(**{('name' if table == 'skills' else 'id'): key, 'data': dict(value)}))
        await self.session.flush()

    async def delete(self, table, key):
        row = await self.session.get(TABLES[table], key)
        if row:
            await self.session.delete(row)

    async def bindings(self, run_id):
        return [dict(r.data) for r in (await self.session.scalars(select(RunSkill).where(RunSkill.run_id == run_id))).all()]

    async def bind(self, run_id, name, version, data):
        row = await self.session.get(RunSkill, (run_id, name))
        if row:
            if row.version != version:
                raise ValueError('同一运行不可替换 Skill 版本')
            row.data = dict(data)
        else:
            self.session.add(RunSkill(run_id=run_id, name=name, version=version, data=dict(data)))
        await self.session.flush()

    async def references(self):
        return set((await self.session.scalars(select(RunSkill.version))).all())


class DBSkillRepository:
    def __init__(self, session_factory):
        self.factory = session_factory

    @asynccontextmanager
    async def transaction(self, run_id=None):
        async with self.factory() as session, session.begin():
            if run_id is not None:
                from app.infrastructure.models.run import RunModel
                from app.domain.services.skill_packages import SkillError
                run = await session.scalar(select(RunModel).where(RunModel.id == run_id).with_for_update())
                if run is None or run.status != 'running':
                    raise SkillError('所属运行已停止或不在执行中，本次写入未提交', 409)
            # 与消息受理一致，先锁运行再锁 skill 目录，避免反向等待。
            # 串行化短暂的目录/预算/版本提交；不能以进程锁替代数据库并发约束。
            await session.execute(text('SELECT pg_advisory_xact_lock(727941503)'))
            yield DBSkillTransaction(session)
