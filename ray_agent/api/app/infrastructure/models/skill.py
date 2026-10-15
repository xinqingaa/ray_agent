"""技能目录、不可变版本、导入与持久运行引用。"""
from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .base import Base


class SkillRecord(Base):
    __tablename__ = 'skills'
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)


class SkillVersion(Base):
    __tablename__ = 'skill_versions'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)


class SkillImport(Base):
    __tablename__ = 'skill_imports'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)


class RunSkill(Base):
    __tablename__ = 'run_skills'
    run_id: Mapped[str] = mapped_column(String(255), ForeignKey('runs.id', ondelete='CASCADE'), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(64), ForeignKey('skill_versions.id'), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
