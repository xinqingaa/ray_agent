#!/usr/bin/env python3
"""沙箱 git 的执行默认值。可被直接调用 /usr/bin/git 或任意 Shell 覆盖，不是访问围栏。"""
import os
import re
import subprocess
import sys

REAL_GIT = "/usr/bin/git"
FIXED = (
    ("core.hooksPath", "/dev/null"),
    ("core.fsmonitor", "false"),
    ("core.pager", "cat"),
    ("diff.external", ""),
    ("protocol.ext.allow", "never"),
    ("gc.auto", "0"),
    ("maintenance.auto", "false"),
)
DRIVER = re.compile(r"^(filter|diff)\.(.+)\.[^.]+$")


def global_prefix(args):
    """保留 subcommand 之前的 Git 全局参数，以 -C/--git-dir 的仓库读配置。"""
    index = 0
    takes_value = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"}
    while index < len(args):
        arg = args[index]
        if arg in takes_value:
            if index + 1 >= len(args):
                break
            index += 2
        elif arg.startswith("-"):
            # 帮助/version 不参与配置查询，交给原 Git 处理。
            if arg in {"--version", "--help", "-h"}:
                return [], args
            index += 1
        else:
            break
    return args[:index], args[index:]


def defaults(raw_config):
    result = list(FIXED)
    drivers = set()
    for record in raw_config.split(b"\0"):
        key = record.split(b"\n", 1)[0].decode("utf-8", errors="replace")
        match = DRIVER.match(key)
        if match:
            drivers.add((match.group(1), match.group(2)))
    for kind, name in sorted(drivers):
        if kind == "filter":
            result.extend((f"filter.{name}.{field}", value)
                          for field, value in (("clean", ""), ("smudge", ""), ("process", ""), ("required", "false")))
        else:
            result.extend((f"diff.{name}.{field}", "") for field in ("command", "textconv"))
    return [part for key, value in result for part in ("-c", f"{key}={value}")]


def main():
    args = sys.argv[1:]
    prefix, command = global_prefix(args)
    try:
        # config 不执行 hooks/filter；includes 内的驱动同样禁用。不修改仓库配置。
        config = subprocess.run([REAL_GIT, *prefix, "config", "--includes", "--null", "--list"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        if config.returncode != 0 or len(config.stdout) > 1024 * 1024:
            raise RuntimeError("仓库 Git 配置无法读取或超过 1 MiB")
        overrides = defaults(config.stdout)
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
        print(f"沙箱 Git 默认配置检查失败：{exc}", file=sys.stderr)
        return 2
    os.execv(REAL_GIT, [REAL_GIT, *prefix, *overrides, *command])


if __name__ == "__main__":
    sys.exit(main())
