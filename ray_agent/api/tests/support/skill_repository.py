"""技能仓储替身，保留事务回滚及持久运行引用契约。"""
import asyncio
import copy
from contextlib import asynccontextmanager


class MemorySkills:
    def __init__(self):
        self.tables = {k: {} for k in ('skills', 'versions', 'imports')}
        self.runs = {}
        self.mutex = asyncio.Lock()

    @asynccontextmanager
    async def transaction(self, run_id=None):
        async with self.mutex:
            backup = copy.deepcopy((self.tables, self.runs))
            try:
                yield self
            except BaseException:
                self.tables, self.runs = backup
                raise

    async def lock(self): pass
    async def get(self, table, key): return copy.deepcopy(self.tables[table].get(key))
    async def all(self, table): return copy.deepcopy(list(self.tables[table].values()))
    async def put(self, table, key, value): self.tables[table][key] = copy.deepcopy(value)
    async def delete(self, table, key): self.tables[table].pop(key, None)
    async def bindings(self, run_id): return copy.deepcopy(list(self.runs.get(run_id, {}).values()))
    async def bind(self, run_id, name, version, data):
        current = self.runs.setdefault(run_id, {}).get(name)
        if current and current['version'] != version:
            raise ValueError('同一运行不可替换版本')
        self.runs[run_id][name] = copy.deepcopy(data)
    async def references(self): return {v['version'] for b in self.runs.values() for v in b.values()}
