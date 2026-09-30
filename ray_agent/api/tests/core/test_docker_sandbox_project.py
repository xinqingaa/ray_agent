"""托管卷参数替身验证；真实 Docker 的属主/停止/子路径仍须另验。"""
import asyncio
from unittest.mock import MagicMock
import pytest
from app.infrastructure.external.project.managed_storage import ManagedProjectStorage
from app.infrastructure.external.sandbox import docker_sandbox as module
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox
from app.domain.external.sandbox import SandboxProjectBindingError
from core.config import Settings


def test_volume_discovery_and_subpath(tmp_path):
    client=MagicMock()
    client.containers.get.return_value.attrs={'Mounts':[{'Type':'volume','Destination':str(tmp_path),'Name':'compose_file_data','RW':True}]}
    client.version.return_value={'ApiVersion':'1.55'}
    store=ManagedProjectStorage(str(tmp_path))
    assert store.initialize(client,in_container=True,container_id='api')
    store.ensure_project('project-1')
    mount=store.mount('project-1')
    assert mount['Source']=='compose_file_data' and mount['Type']=='volume'
    assert mount['VolumeOptions']=={'NoCopy':True,'Subpath':'projects/project-1/files'}
    assert mount['Target']=='/workspace' and not mount['ReadOnly']
    for invalid in ('../../secrets','/etc','x/y'):
        with pytest.raises(ValueError):
            store.mount(invalid)


def test_failed_discovery_has_no_bind_fallback(tmp_path):
    client=MagicMock(); client.containers.get.return_value.attrs={'Mounts':[]}
    store=ManagedProjectStorage(str(tmp_path),local_bind=str(tmp_path))
    assert not store.initialize(client,in_container=True)
    with pytest.raises(ValueError,match='命名卷'):
        store.mount('x')


def test_local_development_is_explicit_and_root_link_rejected(tmp_path):
    store=ManagedProjectStorage(str(tmp_path))
    assert not store.initialize(in_container=False)
    store.local_bind=str(tmp_path); assert store.initialize(in_container=False)
    store.ensure_project('p')
    path=store.files_path('p'); path.rmdir(); path.symlink_to(tmp_path,target_is_directory=True)
    with pytest.raises(OSError):
        store.validate('p')


def test_sandbox_mount_and_shared_rejection(tmp_path,monkeypatch):
    settings=Settings(_env_file=None,sandbox_image='manus-sandbox',sandbox_name_prefix='test',sandbox_network='net')
    monkeypatch.setattr(module,'get_settings',lambda:settings)
    store=ManagedProjectStorage(str(tmp_path),local_bind=str(tmp_path)); store.initialize(in_container=False)
    store.ensure_project('p'); store.volume='compose_file_data'
    monkeypatch.setattr(module,'get_managed_storage',lambda:store)
    client=MagicMock(); client.containers.run.return_value.attrs={'NetworkSettings':{'Networks':{'net':{'IPAddress':'172.18.0.9'}}}}
    monkeypatch.setattr(module.docker,'from_env',lambda:client)
    asyncio.run(DockerSandbox.create(project_id='p'))
    config=client.containers.run.call_args.kwargs
    assert config['mounts'][0]['VolumeOptions']['Subpath']=='projects/p/files'
    assert config['labels']['rayagent.project_id']=='p'
    asyncio.run(DockerSandbox.create())
    assert 'mounts' not in client.containers.run.call_args.kwargs
    settings.sandbox_address='127.0.0.1'
    with pytest.raises(SandboxProjectBindingError):
        asyncio.run(DockerSandbox.create(project_id='p'))
