"""Real local FastAPI protocol checks; no model, build or external request."""
import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

_runtime = tempfile.TemporaryDirectory(prefix='zhixue-android-protocol-')
root = Path(_runtime.name).resolve()
secret = 'test-bridge-secret-' + 'a' * 40
os.environ.update(LMS_ANDROID_BRIDGE_SECRET=secret, AGENT_DATA_DIR=str(root/'data'),
                  AGENT_WORKSPACES_DIR=str(root/'workspaces'), AGENT_BUILDS_DIR=str(root/'builds'),
                  AGENT_CONFIG_PATH=str(root/'disabled.yaml'))
(root/'disabled.yaml').write_text('provider: deepseek\napi_key: ""\nterminal_enabled: false\n')
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

if __name__=='__main__':
    unittest.main()
