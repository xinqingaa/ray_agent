"""真实部署文件闭环观察；不调用模型，不自动删除业务库数据。"""
import argparse
import hashlib
import io
import json
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8088/api')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    evidence = {'started_at': datetime.now().isoformat(), 'url': args.url, 'kind': '真实 Docker/API/业务 PostgreSQL，无模型及浏览器', 'checks': []}
    def save():
        Path(args.output).write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    with httpx.Client(base_url=args.url, timeout=120) as client:
        def request(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            if response.status_code != 200:
                raise AssertionError(f'{method} {path}: {response.status_code} {response.text[:500]}')
            return response.json()['data']
        try:
            project = request('POST', '/projects', json={'name': 'stage-d-files-' + uuid.uuid4().hex[:10], 'instructions': ''})
            project_id = evidence['project_id'] = project['id']; save()
            base = '/projects/' + project_id
            rule = request('GET', '/projects/upload-rules')
            def upload(contents, overwrite=False):
                selection = {'rule_version': rule['version'], 'items': [{'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'overwrite': overwrite} for path, data in contents.items()]}
                pre = request('POST', base+'/uploads/preflight', json=selection)
                assert not pre['errors']
                selection['fingerprint'] = pre['fingerprint']
                op = request('POST', base+'/uploads', json=selection)
                for path, data in contents.items():
                    result = request('PUT', base+f"/uploads/{op['operation_id']}/file", params={'path': path}, files={'file': ('file', data)})
                    assert result['published'], result
                final = request('POST', base+f"/uploads/{op['operation_id']}/finish")
                assert final['results']['batch_status'] == 'completed'
                readback = request('GET', base+f"/operations/{op['operation_id']}")
                assert all(result['published'] for result in readback['results']['received'].values())
                return op
            original = {'材料/原料.csv': b'a,b\n1,2\n', '说明.txt': '不要覆盖原材料'.encode()}
            upload(original)
            evidence['checks'].append('初次上传、NFC 中文路径、原子发布、结果读回'); save()
            reused = {'rule_version': rule['version'], 'items': [{'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in original.items()]}
            reused['fingerprint'] = request('POST', base+'/uploads/preflight', json=reused)['fingerprint']
            op = request('POST', base+'/uploads', json=reused)
            assert all(result['reused'] for result in op['results']['received'].values())
            final = request('POST', base+f"/uploads/{op['operation_id']}/finish")
            assert final['results']['batch_status'] == 'completed'
            evidence['checks'].append('同路径/哈希无需再次上传字节'); save()
            op = upload({'材料/原料.csv': b'a,b\n3,4\n', '产出/extra': b'extra'}, True)
            before = op['before_snapshot_id']; assert before
            snapshots = request('GET', base+'/snapshots')
            assert any(s['id'] == before and s['source'] == 'upload' for s in snapshots)
            evidence['checks'].append('覆盖前真实内容哈希保护快照'); save()
            restored = request('POST', base+'/snapshots/'+before+'/restore')
            assert restored['total_bytes'] == sum(map(len, original.values()))
            archive = client.get(base+'/download'); assert archive.status_code == 200
            with zipfile.ZipFile(io.BytesIO(archive.content)) as zipped:
                assert set(zipped.namelist()) == set(original)
                for path, data in original.items():
                    assert zipped.read(path) == data
                    single = client.get(base+'/download', params={'path': path})
                    assert single.status_code == 200 and single.content == data
            evidence['checks'].append('原地恢复路径及字节、无沙箱单文件/流式 ZIP 下载')
            evidence['source_hashes'] = {p: hashlib.sha256(v).hexdigest() for p,v in original.items()}; save()
            request('POST', base+'/archive', json={'archived': True})
            cleaned = request('POST', base+'/snapshots/cleanup')
            assert cleaned['released_bytes'] > 0 and request('GET', base+'/snapshots') == []
            assert client.get(base+'/download', params={'path': '材料/原料.csv'}).content == original['材料/原料.csv']
            evidence['checks'].append('归档清理快照、实际释放量、保留项目文件')
            evidence['released_bytes'] = cleaned['released_bytes']
            evidence['cleanup_scope'] = {'project_id': project_id, 'name': project['name'], 'tables': ['projects', 'project_audit_events', 'project_snapshots'], 'directory': '/data/files/projects/'+project_id, 'other_resources': '无会话、运行、附件或沙箱；只清理该唯一 id，保留其他数据'}
            evidence['result'] = 'passed'
        except BaseException as exc:
            evidence['result'], evidence['error'] = 'failed', repr(exc)
            raise
        finally:
            evidence['ended_at'] = datetime.now().isoformat(); save()


if __name__ == '__main__':
    main()
