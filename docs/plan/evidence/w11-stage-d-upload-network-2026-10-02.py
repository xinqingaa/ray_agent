"""真实 HTTP 上传断连与持续占用验证。只创建预记录的唯一测试项目。"""
import hashlib, json, pathlib, socket, time, urllib.error, urllib.parse, urllib.request, uuid

record = pathlib.Path(__file__).with_suffix('.json')
assert not record.exists(), '结果存在时必须读回，不重复创建测试项目'
data = {'kind': '真实HTTP/Nginx/API/PG/卷，不是浏览器或模型验收',
    'name': 'stage-d-upload-network-' + uuid.uuid4().hex[:10],
    'scope': '仅本次记录id项目、单个空对话、上传批次和保护快照；已有三项目与用户数据保留', 'steps': []}
def save(): record.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
def api(path, body=None, method=None, headers=None):
    req = urllib.request.Request('http://127.0.0.1:8088/api' + path,
        data=json.dumps(body).encode() if isinstance(body, dict) else body,
        method=method, headers=headers or {'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response: return response.status, json.load(response)
    except urllib.error.HTTPError as error: return error.code, json.load(error)
def ok(path, body=None):
    status, result = api(path, body); assert status == 200, result
    return result['data']
def multipart(name, body):
    boundary = 'raytest-' + uuid.uuid4().hex
    return boundary, (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + body + f'\r\n--{boundary}--\r\n'.encode())
def upload(op, name, body):
    boundary, wire = multipart(name, body)
    status, result = api(f'/projects/{project}/uploads/{op}/file?path={urllib.parse.quote(name)}', wire,
        'PUT', {'Content-Type': 'multipart/form-data; boundary=' + boundary})
    assert status == 200, result
    return result['data']
def start(files, overwrite=()):
    selection = {'rule_version': rule, 'inventory': list(files), 'include_optional': [],
        'items': [{'path': name, 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'overwrite': name in overwrite}
            for name, body in files.items()]}
    checked = ok(f'/projects/{project}/uploads/preflight', selection)
    assert not checked['errors'], checked
    selection['fingerprint'] = checked['fingerprint']
    result = ok(f'/projects/{project}/uploads', selection)
    data['steps'].append({'start': result}); save()
    return result
def readback(op): return ok(f'/projects/{project}/operations/{op}')
def abandon(op, name, body, truncate=False):
    boundary, wire = multipart(name, body)
    path = f'/api/projects/{project}/uploads/{op}/file?path={urllib.parse.quote(name)}'
    header = f'PUT {path} HTTP/1.1\r\nHost: 127.0.0.1:8088\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {len(wire)}\r\nConnection: close\r\n\r\n'.encode()
    with socket.create_connection(('127.0.0.1', 8088), timeout=5) as connection:
        connection.sendall(header + (wire[:len(wire)//2] if truncate else wire))
        if truncate:
            connection.shutdown(socket.SHUT_WR)
        else:
            # 只读取完整响应头，不读取响应体。发送后半关闭连接会让网关提前取消请求。
            received = b''
            while not received.endswith(b'\r\n\r\n'):
                part = connection.recv(1)
                assert part and len(received) < 65536, '响应头中断'
                received += part
            data['steps'].append({'response_body_lost': {'path': name,
                'response_header': received.decode('latin1'), 'body_read': False}})
    data['steps'].append({'abandoned_request': {'path': name, 'partial_body': truncate}}); save()

save()
project = ok('/projects', {'name': data['name']})['id']; data['project_id'] = project; save()
session = ok('/sessions', {'project_id': project})['session_id']; data['session_id'] = session; save()
rule = ok('/projects/upload-rules')['version']
initial = start({'seed.txt': b'initial material'})['operation_id']
assert upload(initial, 'seed.txt', b'initial material')['published']
ok(f'/projects/{project}/uploads/{initial}/finish', {})
files = {'seed.txt': b'revised material', 'lost-response.txt': b'second material', 'failed.txt': b'third material'}
batch = start(files, ('seed.txt',)); op = batch['operation_id']; data['main_operation_id'] = op; save()
assert batch['before_snapshot_id']
assert upload(op, 'seed.txt', files['seed.txt'])['published']
for case, path, body in [
    ('run', '/sessions/' + session + '/chat', {'message': '上传交叉拒绝，不应受理', 'attachments': [], 'mode': 'normal'}),
    ('restore', f'/projects/{project}/snapshots/{batch["before_snapshot_id"]}/restore', {}),
    ('archive', f'/projects/{project}/archive', {'archived': True}),
    ('cleanup', f'/projects/{project}/snapshots/cleanup', {})]:
    status, response = api(path, body); assert status == 409, response
    data['steps'].append({'conflict': case, 'status': status, 'response': response}); save()
abandon(op, 'lost-response.txt', files['lost-response.txt'])
lost = readback(op); data['steps'].append({'readback_after_lost_response': lost}); save()
assert lost['results']['received']['lost-response.txt']['published']
assert upload(op, 'lost-response.txt', files['lost-response.txt'])['reused']
abandon(op, 'failed.txt', files['failed.txt'], True)
bad = upload(op, 'failed.txt', b'x' * len(files['failed.txt']))
assert not bad['published']; data['steps'].append({'hash_rejected': bad}); save()
partial = ok(f'/projects/{project}/uploads/{op}/finish', {})
assert partial['results']['batch_status'] == 'partial_failure'
data['steps'].append({'partial_finish': partial}); save()
retry = start(files); retry_op = retry['operation_id']
assert retry['results']['received']['seed.txt']['reused'] and retry['results']['received']['lost-response.txt']['reused']
assert upload(retry_op, 'failed.txt', files['failed.txt'])['published']
finished = ok(f'/projects/{project}/uploads/{retry_op}/finish', {})
assert finished['results']['batch_status'] == 'completed'
data['steps'].append({'retry_finish': finished}); save()
for name, body in files.items():
    got = urllib.request.urlopen(f'http://127.0.0.1:8088/api/projects/{project}/download?path={urllib.parse.quote(name)}').read()
    assert got == body
data['final_bytes_match'] = True; save()
print(json.dumps({'project_id': project, 'session_id': session, 'steps': len(data['steps']), 'final_bytes_match': True}))
