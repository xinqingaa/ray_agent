#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""读取 OpenAI 兼容 Chat Completions 的 LLM_API_KEY、LLM_MODEL_NAME、LLM_BASE_URL。"""
import os
from pathlib import Path

import dotenv

FOUNDATIONS_DIR = Path(__file__).resolve().parent
PRODUCT_ENV = FOUNDATIONS_DIR.parents[1] / "ray_agent" / ".env"


def load_env_files() -> None:
    dotenv.load_dotenv(FOUNDATIONS_DIR / ".env")
    dotenv.load_dotenv(PRODUCT_ENV)


def chat_completions_url(base: str) -> str:
    base = base.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def llm_settings() -> tuple[str, str, str]:
    load_env_files()
    api_key = os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL_NAME")
    base_url = os.getenv("LLM_BASE_URL")
    missing = [
        name
        for name, value in (
            ("LLM_API_KEY", api_key),
            ("LLM_MODEL_NAME", model),
            ("LLM_BASE_URL", base_url),
        )
        if not value
    ]
    if missing:
        raise SystemExit(
            f"请先配置 {', '.join(missing)}。"
            "写在本目录 .env，或使用 ray_agent/.env 中的同名变量。运行条件见本目录 README。"
        )
    return api_key, model, base_url.rstrip("/")


def openai_client():
    from openai import OpenAI

    api_key, model, base_url = llm_settings()
    return OpenAI(api_key=api_key, base_url=base_url), model


def async_openai_client():
    from openai import AsyncOpenAI

    api_key, model, base_url = llm_settings()
    return AsyncOpenAI(api_key=api_key, base_url=base_url), model
