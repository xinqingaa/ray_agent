from contextlib import asynccontextmanager
from sqlalchemy import select
from app.infrastructure.models.skill import SkillRecord, SkillVersion, SkillImport, RunSkill

TABLES = {'skills': SkillRecord, 'versions': SkillVersion, 'imports': SkillImport}


class DBSkillTransaction:
    def __init__(self, session):
        self.session = session

    async def lock(self):
        """目录、预算与版本提交在写事务内完成；写事务本身串行，不需要另外加锁。"""

    async def get(self, table, key):
        row = await self.session.get(TABLES[table], key, populate_existing=True)
        return dict(row.data) if row else None

    async def all(self, table):
        rows = await self.session.scalars(select(TABLES[table]).execution_options(populate_existing=True))
        return [dict(r.data) for r in rows.all()]

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
            await self.session.flush()

    async def bindings(self, run_id):
        rows = await self.session.scalars(select(RunSkill).where(RunSkill.run_id == run_id))
        return [dict(r.data) for r in rows.all()]

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
    def __init__(self, database):
        self.database = database

    @asynccontextmanager
    async def transaction(self, run_id=None):
        async with self.database.write_session() as session:
            if run_id is not None:
                from app.infrastructure.models.run import RunModel
                from app.domain.services.skill_packages import SkillError
                run = await session.get(RunModel, run_id, populate_existing=True)
                if run is None or run.status != 'running':
                    raise SkillError('所属运行已停止或不在执行中，本次写入未提交', 409)
            yield DBSkillTransaction(session)
