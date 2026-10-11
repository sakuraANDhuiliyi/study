"""Real local FastAPI protocol checks; no model, build or external request."""
import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
import sqlite3
from pathlib import Path

_runtime = tempfile.TemporaryDirectory(prefix='zhixue-android-protocol-')
root = Path(_runtime.name).resolve()
secret = 'test-bridge-secret-' + 'a' * 40
os.environ.update(LMS_ANDROID_BRIDGE_SECRET=secret, AGENT_DATA_DIR=str(root/'data'),
                  AGENT_WORKSPACES_DIR=str(root/'workspaces'), AGENT_BUILDS_DIR=str(root/'builds'),
                  AGENT_CONFIG_PATH=str(root/'disabled.yaml'))
(root/'disabled.yaml').write_text('provider: deepseek\napi_key: ""\nterminal_enabled: false\ncreative_catalog_enabled: true\ncreative_bootstrap_builtins: true\n')
from fastapi.testclient import TestClient
from lms_bridge import app

class BridgeProtocol(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        _runtime.cleanup()

    def signed(self, method, path, body=None, owner='lms_'+'a'*48, nonce=None):
        content = '' if body is None else json.dumps(body,ensure_ascii=False)
        stamp=str(int(time.time()))
        nonce=nonce or os.urandom(16).hex()
        digest=hashlib.sha256(content.encode()).hexdigest()
        message='\n'.join([method,path,owner,stamp,nonce,digest])
        headers={'x-lms-owner':owner,'x-lms-time':stamp,'x-lms-nonce':nonce,
                 'x-lms-signature':hmac.new(secret.encode(),message.encode(),hashlib.sha256).hexdigest(),
                 'content-type':'application/json'}
        return self.client.request(method,path,content=content,headers=headers)

    def setUp(self):
        self.client=TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_unsigned_and_replayed_requests_are_rejected(self):
        self.assertEqual(self.client.get('/api/projects').status_code,401)
        nonce=os.urandom(16).hex()
        self.assertEqual(self.signed('GET','/api/projects',nonce=nonce).status_code,200)
        self.assertEqual(self.signed('GET','/api/projects',nonce=nonce).status_code,401)
        health=self.signed('GET','/api/health')
        self.assertEqual(health.status_code,200)
        self.assertEqual(health.json()['user_id'],'lms_'+'a'*48)
        self.assertEqual(health.json()['api_key_configured'],False)

    def test_real_project_template_and_other_owner_isolation(self):
        result=self.signed('POST','/api/projects',{'name':'协议验证','package':'com.zhixue.protocol'})
        self.assertEqual(result.status_code,201,result.text)
        project=result.json()['id']
        self.assertEqual(self.signed('GET',f'/api/projects/{project}').status_code,200)
        self.assertEqual(self.signed('GET',f'/api/projects/{project}',owner='lms_'+'b'*48).status_code,404)
        foreign=self.signed('GET','/api/projects',owner='lms_'+'b'*48)
        self.assertEqual(foreign.json()['projects'],[])
        self.assertEqual(self.signed('GET',f'/api/projects/{project}/apk').status_code,404)
        from agent.paths import user_builds_dir
        artifact = user_builds_dir('lms_'+'a'*48)/project/'latest.apk'
        artifact.parent.mkdir(parents=True,exist_ok=True)
        artifact.write_bytes(b'PK-protocol-download-fixture')
        download=self.signed('GET',f'/api/projects/{project}/apk')
        self.assertEqual(download.status_code,200)
        self.assertEqual(download.content,artifact.read_bytes())
        self.assertIn('attachment',download.headers['content-disposition'])
        self.assertEqual(self.signed('GET',f'/api/projects/{project}/apk',owner='lms_'+'b'*48).status_code,404)
        archive=self.signed('GET',f'/api/projects/{project}/source.zip')
        self.assertEqual(archive.status_code,200)
        self.assertTrue(archive.content.startswith(b'PK'))
        self.assertEqual(self.signed('GET',f'/api/projects/{project}/source.zip',owner='lms_'+'b'*48).status_code,404)
        self.assertEqual(self.signed('POST',f'/api/projects/{project}/build/cancel').status_code,404)
        self.assertEqual(self.signed('DELETE',f'/api/projects/{project}').status_code,204)

    def test_build_overlap_and_owner_bound_cancel(self):
        from concurrent.futures import ThreadPoolExecutor
        from unittest.mock import patch
        from types import SimpleNamespace
        import threading
        started=threading.Event();release=threading.Event()
        project=self.signed('POST','/api/projects',{'name':'构建互斥验证'}).json()['id']
        def controlled_build(*args,**kwargs):
            started.set()
            if not release.wait(5):
                raise RuntimeError('controlled test build was not released')
            return SimpleNamespace(ok=False,output='controlled canceled build',summary={})
        with patch('lms_bridge.run_gradle',controlled_build), patch('lms_bridge.cancel_gradle',return_value=True):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(self.signed,'POST',f'/api/projects/{project}/build')
                try:
                    self.assertTrue(started.wait(3))
                    self.assertEqual(self.signed('POST',f'/api/projects/{project}/build').status_code,429)
                    self.assertEqual(self.signed('POST',f'/api/projects/{project}/build/cancel',owner='lms_'+'b'*48).status_code,404)
                    self.assertEqual(self.signed('POST',f'/api/projects/{project}/build/cancel').status_code,200)
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=5).status_code,200)
        self.assertEqual(self.signed('DELETE',f'/api/projects/{project}').status_code,204)

    def test_client_cannot_supply_identity_in_project_body(self):
        result=self.signed('POST','/api/projects',{'name':'拒绝身份覆盖','user_id':'other'})
        self.assertEqual(result.status_code,422)

    def test_lms_does_not_install_unreachable_creative_catalog(self):
        import lms_bridge
        self.assertFalse(lms_bridge.settings.creative_catalog_enabled)
        self.assertFalse(lms_bridge.settings.creative_bootstrap_builtins)
        self.assertFalse(lms_bridge.settings.admin_ui_enabled)
        self.assertFalse(hasattr(app.state,'creative_store'))
        self.assertFalse(any(getattr(route,'path','').startswith('/api/creative') for route in app.routes))
        self.assertFalse(any(getattr(route,'path','').startswith('/admin') for route in app.routes))
        self.assertEqual(self.signed('GET','/api/creative/items').status_code,404)
        self.assertEqual(self.signed('GET','/admin/').status_code,404)
        with sqlite3.connect(app.state.task_store.db_path) as db:
            tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertFalse(any(name.startswith('creative') for name in tables))

    def test_disabled_catalog_never_imports_modules_and_preserves_old_rows(self):
        import builtins
        from dataclasses import replace
        from unittest.mock import patch
        from agent.api import create_app
        from lms_bridge import settings
        with sqlite3.connect(app.state.task_store.db_path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS creative_legacy_sentinel(id TEXT PRIMARY KEY)')
            db.execute("INSERT OR REPLACE INTO creative_legacy_sentinel VALUES ('preserve-me')")
        original_import=builtins.__import__
        def guarded_import(name,*args,**kwargs):
            if name.startswith('agent.creative'):
                raise AssertionError('Disabled catalog imported optional subsystem')
            return original_import(name,*args,**kwargs)
        try:
            with patch('builtins.__import__',guarded_import):
                created=create_app(replace(settings,creative_catalog_enabled=False))
            self.assertFalse(hasattr(created.state,'creative_store'))
            with sqlite3.connect(app.state.task_store.db_path) as db:
                self.assertEqual(db.execute('SELECT id FROM creative_legacy_sentinel').fetchall(),[('preserve-me',)])
        finally:
            with sqlite3.connect(app.state.task_store.db_path) as db:
                db.execute('DROP TABLE creative_legacy_sentinel')

    def test_standalone_enabled_catalog_still_initializes_and_registers(self):
        from dataclasses import replace
        from agent.api import create_app
        from agent.database import TaskStore
        from lms_bridge import settings
        separate=TaskStore(db_path=root/'standalone.sqlite')
        try:
            created=create_app(replace(settings,creative_catalog_enabled=True,creative_bootstrap_builtins=False),task_store=separate)
            self.assertTrue(hasattr(created.state,'creative_store'))
            with TestClient(created) as client:
                self.assertEqual(client.get('/api/creative/items').status_code,200)
        finally:
            from agent.jobs import configure_task_store
            configure_task_store(app.state.task_store,settings)

if __name__=='__main__':
    unittest.main()
