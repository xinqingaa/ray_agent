"""当前核心进程持有运行冻结的连接，终态释放凭据。"""
from app.domain.models.llm_endpoints import LlmEndpoint

run_connections: dict[str, LlmEndpoint] = {}
