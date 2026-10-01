"""运行冻结的项目段，只拼接请求，不写基础对话记忆。"""
from typing import Sequence


def bounded_summaries(summaries: Sequence[dict]) -> list[dict]:
    selected, remaining = [], 1500
    for item in summaries[:10]:
        if remaining <= 0:
            break
        text = (f"对话 {item['session_id']}（{item.get('source') or 'auto'}，截止 seq {item.get('source_seq', 0)}）："
                + item['summary'])[:remaining]
        selected.append({**item, 'injected_text': text})
        remaining -= len(text)
    return selected


def snapshot_prompt(snapshot, language='zh') -> str:
    return build_project_prompt(snapshot.instructions, snapshot.notes, snapshot.notes_version,
        [item['injected_text'] for item in snapshot.summaries], language=language)


def build_project_prompt(instructions: str | None, notes: str | None = None,
                         notes_version: int = 0, summaries: Sequence[str] = (), *, language='zh') -> str:
    selected, remaining = [], 1500
    for summary in summaries[:10]:
        if remaining <= 0:
            break
        text = summary[:remaining]
        selected.append(text)
        remaining -= len(text)
    if language == 'en':
        from app.domain.services.prompts.en.project import build_project_prompt_en
        return build_project_prompt_en(instructions, notes, notes_version, selected)
    return ('\n<project_context>\n项目说明：\n' + (instructions or '（未设置）')
            + f'\n项目笔记（版本 {notes_version}）：\n' + (notes or '（未设置）')
            + '\n近期对话摘要（有限近期背景，不替代材料与完整历史）：\n' + '\n'.join(selected)
            + '\n项目文件与对话保留；项目运行间浏览器登录和终端状态不保证延续。'
            + '\n在任务结束或得出可复用的结论、决策、待办、重要文件位置时，用 update_project_notes 更新笔记；'
              '不逐轮记录过程，不重复文件可直接读取的内容。\n</project_context>\n')
