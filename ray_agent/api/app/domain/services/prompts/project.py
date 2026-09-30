"""运行开始时生成的项目段；只拼到请求，不保存到对话记忆。"""
from typing import Sequence


def build_project_prompt(instructions: str | None, notes: str | None = None,
                         notes_version: int = 0, summaries: Sequence[str] = ()) -> str:
    selected, remaining = [], 1500
    for summary in summaries[:10]:
        if remaining <= 0:
            break
        text = summary[:remaining]
        selected.append(text)
        remaining -= len(text)
    # 写笔记的提示随笔记工具一起接入；现在没有该工具，不能要求模型去更新。
    return ("\n<project_context>\n项目说明：\n" + (instructions or "（未设置）")
            + f"\n项目笔记（版本 {notes_version}）：\n" + (notes or "（未设置）")
            + "\n近期对话摘要（有限近期背景，不替代材料与完整历史）：\n" + "\n".join(selected)
            + "\n项目文件与对话保留；项目运行间浏览器登录和终端状态不保证延续。\n</project_context>\n")
