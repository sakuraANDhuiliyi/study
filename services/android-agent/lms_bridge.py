"""Run the original Android Agent behind the LMS-only signed bridge."""
import hashlib
import hmac
import os
import time
from dataclasses import replace
from fastapi import Request, HTTPException
from starlette.responses import JSONResponse
from agent.api import create_app
from agent.config import load_settings
from agent.users import AuthIdentity

secret = os.environ.get('LMS_ANDROID_BRIDGE_SECRET', '')
if len(secret) < 32:
    raise RuntimeError('LMS bridge secret is required')
settings = replace(load_settings(), server_host='127.0.0.1', registration_enabled=False,
                   guest_sessions_enabled=False, admin_ui_enabled=False, debug_web_ui_enabled=False,
                   terminal_enabled=False, creative_submissions_enabled=False)
app = create_app(settings)
seen = {}

@app.middleware('http')
async def signed_request(request: Request, call_next):
    owner = request.headers.get('x-lms-owner', '')
    stamp = request.headers.get('x-lms-time', '')
    nonce = request.headers.get('x-lms-nonce', '')
    signature = request.headers.get('x-lms-signature', '')
    body = await request.body()
    uri = request.url.path + ('?' + request.url.query if request.url.query else '')
    payload = '\n'.join([request.method, uri, owner, stamp, nonce, hashlib.sha256(body).hexdigest()])
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    now = time.time()
    valid = len(owner) == 52 and owner.startswith('lms_') and all(c in '0123456789abcdef' for c in owner[4:])
    try:
        valid = valid and abs(now - int(stamp)) <= 30
    except ValueError:
        valid = False
    if not valid or len(nonce) != 32 or not hmac.compare_digest(expected, signature) or nonce in seen:
        return JSONResponse({'detail': 'Bridge authentication required'}, status_code=401)
    for key, value in list(seen.items()):
        if value < now - 60:
            del seen[key]
    if len(seen) >= 10000:
        return JSONResponse({'detail': 'Bridge busy'}, status_code=429)
    seen[nonce] = now
    request.state.lms_owner = owner
    return await call_next(request)

async def lms_identity(request: Request):
    owner = getattr(request.state, 'lms_owner', None)
    if not owner:
        raise HTTPException(401, 'Bridge authentication required')
    return AuthIdentity(owner, None)

# Override the original identity dependency; keep the original per-user project,
# task, conversation and artifact authorization everywhere downstream.
def override(dependency):
    if getattr(dependency.call, '__name__', '') == 'current_identity':
        app.dependency_overrides[dependency.call] = lms_identity
    for child in dependency.dependencies:
        override(child)
for route in app.routes:
    if hasattr(route, 'dependant'):
        override(route.dependant)

# Local build/export actions reuse the original project lock, path guards and
# OS sandbox. They do not call an AI provider and never execute host shell text.
from fastapi import Depends
from fastapi.responses import Response
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from agent.paths import workspace_path
from agent.project import load_project_meta
from agent.project_lifecycle import project_operation
from agent.tools import run_gradle, cancel_gradle
import threading
from agent.processes import CancellationRequested
_build_guard = threading.Lock()
_active_builds = {}
from agent.safe_paths import open_workspace_file

def idle_project(owner, project_id):
    load_project_meta(owner, project_id)
    if any(job['status'] in {'queued','running','paused','awaiting_approval','cancel_requested'}
           for job in app.state.task_store.list_tasks(owner, project_id)):
        raise HTTPException(409, '项目仍有活跃任务，请先完成或取消任务')

@app.post('/api/projects/{project_id}/build')
def build_project(project_id: str, identity=Depends(lms_identity)):
    owner=identity.user_id
    key=(owner,project_id)
    with _build_guard:
        if key in _active_builds or len(_active_builds)>=2:
            raise HTTPException(429,'构建资源繁忙，请等待当前构建结束')
        stop=threading.Event()
        _active_builds[key]=stop
    def canceled():
        if stop.is_set():
            raise CancellationRequested('构建已取消')
    try:
        with project_operation(owner, project_id):
            idle_project(owner, project_id)
            result=run_gradle(workspace_path(owner, project_id),owner,project_id,'assembleDebug',cancel_check=canceled)
            return {'ok':result.ok,'message':result.output,'summary':result.summary}
    except FileNotFoundError as exc:
        raise HTTPException(404,'项目不存在') from exc
    finally:
        with _build_guard:
            _active_builds.pop(key,None)

@app.post('/api/projects/{project_id}/build/cancel')
def cancel_build(project_id: str,identity=Depends(lms_identity)):
    key=(identity.user_id,project_id)
    with _build_guard:
        stop=_active_builds.get(key)
        if not stop:
            raise HTTPException(404,'没有正在进行的构建')
        stop.set()
    cancel_gradle(*key)
    return {'cancel_requested':True}

@app.get('/api/projects/{project_id}/source.zip')
def export_source(project_id: str, identity=Depends(lms_identity)):
    owner=identity.user_id
    try:
        with project_operation(owner,project_id):
            idle_project(owner,project_id)
            workspace=workspace_path(owner,project_id)
            buffer=BytesIO();total=0;count=0
            with ZipFile(buffer,'w',ZIP_DEFLATED) as archive:
                for file in sorted(workspace.rglob('*')):
                    relative=file.relative_to(workspace)
                    if any(part.startswith('.') or part in {'build','local.properties','__pycache__'} for part in relative.parts):
                        continue
                    if file.is_symlink() or not file.is_file():
                        continue
                    count+=1
                    with open_workspace_file(workspace,relative.as_posix()) as stream:
                        content=stream.read(20*1024*1024+1)
                    total+=len(content)
                    if count>1000 or total>20*1024*1024:
                        raise HTTPException(413,'源码包超过下载上限')
                    archive.writestr(relative.as_posix(),content)
            return Response(buffer.getvalue(),media_type='application/zip',
                            headers={'Content-Disposition':f'attachment; filename="{project_id}-source.zip"'})
    except FileNotFoundError as exc:
        raise HTTPException(404,'项目不存在') from exc


# Explicit manual builds also stop when the responding worker shuts down.
from contextlib import asynccontextmanager
_original_lifespan=app.router.lifespan_context
@asynccontextmanager
async def bridge_lifespan(application):
    async with _original_lifespan(application):
        try:
            yield
        finally:
            with _build_guard:
                active=list(_active_builds.items())
                for _,stop in active:
                    stop.set()
            for key,_ in active:
                cancel_gradle(*key)
app.router.lifespan_context=bridge_lifespan
