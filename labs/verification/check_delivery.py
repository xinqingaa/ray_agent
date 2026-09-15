"""对照宽松与按要求验收的检查器；合成结果不代表 Agent 运行表现。"""
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
import csv
import io
import json

SOURCE = b'item,amount\na,12\nb,18\nc,30\n'
# 预期值由教学样本独立给出，不从待验收报告反推。
EXPECTED_TOTAL = 60


@dataclass
class Observation:
    report: bytes | None
    source_after: bytes
    downloaded: bytes | None
    delivery_observed: bool


def inspect(obs: Observation) -> dict:
    checks = {'source_preserved': obs.source_after == SOURCE}
    try:
        report = json.loads(obs.report) if obs.report is not None else None
        checks['report_correct'] = (
            isinstance(report, dict)
            and type(report.get('total')) is int
            and report['total'] == EXPECTED_TOTAL
        )
    except (ValueError, UnicodeDecodeError):
        checks['report_correct'] = False
    checks['delivery_matches'] = (
        obs.report is not None and obs.downloaded == obs.report
        if obs.delivery_observed else None
    )
    verdict = ('fail' if False in checks.values() else
               'unknown' if None in checks.values() else 'pass')
    return {'verdict': verdict, 'checks': checks}


def main():
    valid = b'{"total":60}\n'
    variants = [
        ('correct', valid, SOURCE, valid, True, 'pass'),
        ('valid_format', b'{ "total": 60, "note": "ok" }', SOURCE,
         b'{ "total": 60, "note": "ok" }', True, 'pass'),
        ('wrong_total', b'{"total":59}', SOURCE, b'{"total":59}', True, 'fail'),
        ('missing_report', None, SOURCE, None, True, 'fail'),
        ('changed_source', valid, SOURCE + b'd,1\n', valid, True, 'fail'),
        ('stale_download', valid, SOURCE, b'{"total":59}', True, 'fail'),
        ('delivery_unobserved', valid, SOURCE, None, False, 'unknown'),
    ]
    # 校验输入样本与独立答案一致；这不是读取 Agent 输出来生成标准答案。
    assert sum(int(r['amount']) for r in csv.DictReader(io.StringIO(SOURCE.decode()))) == EXPECTED_TOTAL
    loose_false_pass = 0
    with TemporaryDirectory(prefix='rayagent-verification-') as root:
        for name, report, source, downloaded, observed, expected in variants:
            case = Path(root) / name
            case.mkdir()
            (case / 'source.csv').write_bytes(source)
            if report is not None:
                (case / 'summary.json').write_bytes(report)
            obs = Observation(
                (case / 'summary.json').read_bytes() if report is not None else None,
                (case / 'source.csv').read_bytes(), downloaded, observed)
            loose = (case / 'summary.json').exists()
            result = inspect(obs)
            assert result['verdict'] == expected, (name, result)
            loose_false_pass += loose and expected != 'pass'
            print(json.dumps({'case': name, 'expected': expected,
                              'exists_only_pass': loose, **result}, ensure_ascii=False))
    print(f'检查器对照：7 个构造样本；存在即通过误接受 {loose_false_pass} 个；分项判定与预设标签全部一致。')
    print('下载字节是合成观察，未访问产品下载接口；未检查完整动作轨迹与权限。')


if __name__ == '__main__':
    main()
