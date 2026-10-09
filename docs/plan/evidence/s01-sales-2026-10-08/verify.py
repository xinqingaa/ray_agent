"""只读核对 S01 留存输入与 Artifact Tool 导出的全部单元格；不调用模型。"""
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).resolve().parent
checks = []


def check(name, passed, detail):
    checks.append({'name': name, 'passed': bool(passed), 'detail': detail})


raw = []
source_names = defaultdict(set)
for path in sorted((BASE / 'inputs').glob('*.csv')):
    rows = list(csv.DictReader(path.open(encoding='utf-8', newline='')))
    check(path.name + ' 输入条数', len(rows) == 100, len(rows))
    for row in rows:
        row = dict(row)
        source_names[row['订单编号']].add(path.name)
        raw.append(row)

unique = {}
for row in raw:
    oid = row['订单编号']
    if oid in unique:
        assert unique[oid] == row, '夹具不能包含内容冲突的重复订单'
    unique[oid] = row
valid = {k: v for k, v in unique.items() if v['金额'] != ''}
missing = {k: v for k, v in unique.items() if v['金额'] == ''}
counts, amounts = Counter(), defaultdict(Decimal)
for row in valid.values():
    counts[row['渠道']] += 1
    amounts[row['渠道']] += Decimal(row['金额'])
check('夹具与登记规格一致', len(raw) == 300 and len(unique) == 288 and len(valid) == 283 and set(missing) == {f'S{i:04d}' for i in range(284, 289)} and dict(amounts) == {'线上': Decimal('18640.00'), '线下': Decimal('12760.00')}, {'raw': len(raw), 'unique': len(unique), 'valid': len(valid), 'missing': list(missing), 'amounts': {k: str(v) for k, v in amounts.items()}})

book = json.loads((BASE / 'workbook-values.json').read_text())
detail_rows = book['去重后明细']['values'][1:]
check('交付明细无重复、漏项或额外订单', len(detail_rows) == len(unique) and Counter(r[0] for r in detail_rows) == Counter(unique.keys()), {'actual_rows': len(detail_rows), 'expected_rows': len(unique)})
differences = []
for oid, channel, amount, source in detail_rows:
    expected = unique.get(oid)
    if not expected:
        differences.append([oid, '意外订单'])
        continue
    amount_ok = amount == '金额缺失' if expected['金额'] == '' else isinstance(amount, (int, float)) and Decimal(str(amount)) == Decimal(expected['金额'])
    if channel != expected['渠道'] or not amount_ok or set(source.split('+')) != source_names[oid]:
        differences.append([oid, channel, amount, source])
check('288 条明细的渠道、金额/缺失标识及来源逐条一致', not differences, differences)

missing_rows = book['金额缺失订单']['values'][1:]
check('缺失订单清单及来源准确且未填零', len(missing_rows) == 5 and Counter(r[0] for r in missing_rows) == Counter(missing.keys()) and all(r[1] == '线下' and r[2] == '(空)' and r[3] == '销售表C.csv' for r in missing_rows), missing_rows)
summary_rows = book['销售汇总']['values']
expected_summary = {'线上': (160, Decimal('18640.00')), '线下': (123, Decimal('12760.00')), '合计': (283, Decimal('31400.00'))}
observed = {r[0]: (r[1], Decimal(str(r[2]))) for r in summary_rows if r[0] in expected_summary}
check('渠道计数及总金额与独立 Decimal 计算一致', observed == expected_summary and sum(amounts.values()) == Decimal('31400.00'), {k: [v[0], str(v[1])] for k, v in observed.items()})
expected_counts = {'原始记录总条数': 300, '合并去重后订单数': 288, '重复订单删除条数': 12, '含有效金额订单数': 283, '金额缺失订单数': 5}
observed_counts = {r[0]: r[1] for r in summary_rows if r[0] in expected_counts}
check('处理数量及守恒关系正确', observed_counts == expected_counts and 300 == 12 + 5 + 283, observed_counts)
check('工作簿明确缺失金额未计入销售额', any('未计入上表销售额' in str(r[0]) for r in summary_rows), '销售汇总!A15')
sources = json.loads((BASE / 'sources-check.json').read_text())
check('三份沙箱原始文件字节保持一致', len(sources) == 3 and all(r['unchanged'] and r['expected_sha256'] == r['actual_sha256'] for r in sources), sources)
downloads = json.loads((BASE / 'downloads.json').read_text())
check('交付副本哈希与下载时一致', all(hashlib.sha256((BASE / x['relative_path']).read_bytes()).hexdigest() == x['sha256'] for x in downloads), downloads)
run = json.loads((BASE / 'run.json').read_text())
session = json.loads((BASE / 'session.json').read_text())
turns = [e['data'] for e in session['events'] if e['event'] == 'turn' and e['data'].get('phase') == 'completed']
check('用量汇总与逐轮事件一致', run['metrics_consistent'] and sum((t.get('usage') or {}).get('cached_tokens', 0) or 0 for t in turns) == run['cached_tokens'], {k: run[k] for k in ['model_calls', 'tool_calls', 'prompt_tokens', 'completion_tokens', 'cached_tokens', 'usage_unavailable_calls']})
check('没有人工补充或审批续接', all(i['kind'] not in ['reply', 'approval_reply'] for i in run['interactions']) and not any(e['event'] in ['wait', 'approval'] for e in session['events']), run['interactions'])

report = {'scope': '独立数据及用量核对；最终回复语义、工具依据和视觉观察另见报告', 'passed': all(c['passed'] for c in checks), 'checks': checks}
(BASE / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': report['passed'], 'checks': len(checks), 'failures': [c for c in checks if not c['passed']]}, ensure_ascii=False))
raise SystemExit(0 if report['passed'] else 1)
