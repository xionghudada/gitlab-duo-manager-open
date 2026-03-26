import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from html import escape as html_escape
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import ConfigManager
from keys import KeyManager
from logs import LogManager
from proxy import proxy_messages as do_proxy, MODELS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

config_mgr = ConfigManager()
key_mgr = KeyManager(config_mgr)
log_mgr = LogManager()
oauth_states: dict[str, dict] = {}


def _mask(value: str) -> str:
    return f"{value[:8]}...{value[-4:]}" if len(value) > 12 else "***"


def _serialize_key(key) -> dict:
    credential_display = _mask(key.pat) if key.auth_type == "pat" else f"OAuth / {key.gitlab_username or key.name}"
    data = key.model_dump(exclude={"pat", "oauth_access_token", "oauth_refresh_token"})
    return {
        **data,
        "pat": credential_display,
        "credential_display": credential_display,
        **key_mgr.get_key_status(key),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    await key_mgr.refresh_all_tokens()
    await key_mgr.start_refresh_loop()
    await key_mgr.start_validation_loop()
    if config_mgr.login_setup_required:
        logging.info("Admin password is not configured yet, please complete setup on the login page")
    else:
        logging.info("Admin password loaded from %s", config_mgr.admin_password_source)
    for ak in config_mgr.config.settings.api_keys:
        logging.info("API Key [%s]: %s", ak.name, _mask(ak.key))
    yield
    await key_mgr.stop()


app = FastAPI(title="GitLab Duo Manager", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _err(msg: str, status: int = 400) -> Response:
    return Response(content=json.dumps({"error": {"message": msg}}), status_code=status, media_type="application/json")


def _get_bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.headers.get("x-api-key", "")


def _verify_admin(request: Request) -> Response | None:
    token = _get_bearer(request)
    if token != config_mgr.config.settings.admin_password:
        return _err("未授权", 401)
    return None


def _verify_proxy_key(request: Request) -> Response | None:
    token = _get_bearer(request)
    if not config_mgr.find_api_key(token):
        return _err("Invalid API key", 401)
    return None


def _get_proxy_key(request: Request):
    token = _get_bearer(request)
    return config_mgr.find_api_key(token)


# --- Login ---

class LoginReq(BaseModel):
    password: str
    save_to_config: bool = False


class ChangeAdminPasswordReq(BaseModel):
    current_password: str
    new_password: str


class GitLabLoginReq(BaseModel):
    pat: str
    name: str | None = None


@app.get("/api/login/meta")
async def login_meta():
    return {
        "setup_required": config_mgr.login_setup_required,
        "can_save_to_config": config_mgr.can_persist_admin_password,
        "password_source": config_mgr.admin_password_source,
    }


@app.post("/api/login")
async def login(req: LoginReq):
    password = req.password.strip()
    if not password:
        return _err("密码不能为空", 400)

    if config_mgr.login_setup_required:
        if not req.save_to_config:
            return _err("当前尚未初始化管理密码，请在登录页完成首次设置", 400)
        if not config_mgr.can_persist_admin_password:
            return _err("当前管理密码由环境变量控制，无法写入 config.json", 400)
        token = config_mgr.set_admin_password(password)
        return {"token": token, "setup_completed": True}

    if password != config_mgr.config.settings.admin_password:
        return _err("密码错误", 401)
    return {"token": config_mgr.config.settings.admin_password, "setup_completed": False}


@app.get("/api/admin-password/meta")
async def admin_password_meta(request: Request):
    if err := _verify_admin(request):
        return err
    return {
        "can_update": config_mgr.can_persist_admin_password,
        "password_source": config_mgr.admin_password_source,
    }


@app.post("/api/admin-password")
async def change_admin_password(request: Request, req: ChangeAdminPasswordReq):
    if err := _verify_admin(request):
        return err
    try:
        token = config_mgr.change_admin_password(req.current_password, req.new_password)
    except ValueError as exc:
        return _err(str(exc), 400)
    return {
        "token": token,
        "password_source": config_mgr.admin_password_source,
    }


@app.post("/api/gitlab/login")
async def gitlab_login(request: Request, req: GitLabLoginReq):
    if err := _verify_admin(request):
        return err

    pat = req.pat.strip()
    if not pat:
        return _err("GitLab PAT 不能为空", 400)
    if any(k.pat == pat for k in config_mgr.config.keys):
        return _err("该 GitLab PAT 已存在", 409)

    try:
        user = await key_mgr.fetch_gitlab_user(pat)
    except Exception as exc:
        return _err(str(exc), 400)

    display_name = (req.name or "").strip() or user.get("username") or user.get("name") or f"GitLab {user.get('id', '')}".strip()
    key = config_mgr.add_key(display_name, pat)

    token_ttl = 0
    try:
        entry = await key_mgr.get_token(pat)
        token_ttl = entry.ttl
    except Exception:
        config_mgr.remove_key(key.id)
        key_mgr.cleanup_key(key.id, pat)
        return _err("GitLab 登录成功，但该账号无法获取 Duo 访问 token", 400)

    return {
        "key": _serialize_key(key),
        "account": {
            "id": user.get("id"),
            "username": user.get("username") or "",
            "name": user.get("name") or "",
            "email": user.get("email") or "",
            "avatar_url": user.get("avatar_url") or "",
            "web_url": user.get("web_url") or "",
        },
        "token_ttl": token_ttl,
        "message": "GitLab 账号已验证，凭证已写入 config.json",
    }


def _oauth_redirect_uri(request: Request) -> str:
    return config_mgr.gitlab_oauth_redirect_uri or str(request.url_for("gitlab_oauth_callback"))


@app.get("/api/gitlab/oauth/meta")
async def gitlab_oauth_meta(request: Request):
    if err := _verify_admin(request):
        return err
    return {
        "configured": config_mgr.gitlab_oauth_configured,
        "gitlab_url": config_mgr.config.settings.gitlab_url,
        "redirect_uri": _oauth_redirect_uri(request),
    }


@app.post("/api/gitlab/oauth/start")
async def gitlab_oauth_start(request: Request):
    if err := _verify_admin(request):
        return err
    if not config_mgr.gitlab_oauth_configured:
        return _err("请先配置 GITLAB_OAUTH_CLIENT_ID 和 GITLAB_OAUTH_CLIENT_SECRET", 400)
    # Cleanup expired states
    now = time.time()
    expired = [k for k, v in oauth_states.items() if v.get("expires_at", 0) < now]
    for k in expired:
        del oauth_states[k]
    state = secrets.token_urlsafe(24)
    redirect_uri = _oauth_redirect_uri(request)
    oauth_states[state] = {"expires_at": time.time() + 600, "redirect_uri": redirect_uri}
    params = urlencode({
        "client_id": config_mgr.gitlab_oauth_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "api read_user",
        "state": state,
    })
    return {"authorize_url": f"{config_mgr.config.settings.gitlab_url}/oauth/authorize?{params}"}


@app.get("/api/gitlab/oauth/callback", name="gitlab_oauth_callback")
async def gitlab_oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return _oauth_popup_html(False, f"GitLab OAuth 失败: {error}")
    if not code or not state:
        return _oauth_popup_html(False, "GitLab OAuth 缺少 code/state")

    state_entry = oauth_states.pop(state, None)
    if not state_entry or state_entry.get("expires_at", 0) < time.time():
        return _oauth_popup_html(False, "GitLab OAuth state 无效或已过期")

    try:
        token_data = await key_mgr.exchange_oauth_code(code, state_entry["redirect_uri"])
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", "")
        expires_in = token_data.get("expires_in") or 7200
        expires_at = time.time() + max(float(expires_in), 60.0)
        user = await key_mgr.fetch_gitlab_user_with_access_token(access_token)
        if config_mgr.find_oauth_key_by_user(user.get("id"), user.get("username") or ""):
            return _oauth_popup_html(False, "该 GitLab OAuth 账号已存在")
        display_name = user.get("username") or user.get("name") or f"GitLab {user.get('id', '')}".strip()
        key = config_mgr.add_oauth_key(
            name=display_name,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
            gitlab_user_id=user.get("id"),
            gitlab_username=user.get("username") or "",
            gitlab_email=user.get("email") or "",
        )
        try:
            await key_mgr.get_token(key)
        except Exception:
            config_mgr.remove_key(key.id)
            key_mgr.cleanup_key(key.id)
            return _oauth_popup_html(False, "GitLab OAuth 登录成功，但该账号无法获取 Duo 访问 token")
        payload = {
            "ok": True,
            "message": "GitLab OAuth 登录成功，账号已写入 config.json",
            "account": {"username": user.get("username") or "", "name": user.get("name") or ""},
        }
        return _oauth_popup_html(True, payload["message"], payload)
    except Exception as exc:
        return _oauth_popup_html(False, str(exc))


def _oauth_popup_html(ok: bool, message: str, payload: dict | None = None) -> HTMLResponse:
    safe_message = html_escape(message)
    body = {
        "type": "gitlab-oauth-result",
        "ok": ok,
        "message": message,
        **(payload or {}),
    }
    html = f"""<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>GitLab OAuth</title></head>
<body style="font-family: sans-serif; padding: 24px;">
  <h2>{'登录成功' if ok else '登录失败'}</h2>
  <p>{safe_message}</p>
  <script>
    const payload = {json.dumps(body, ensure_ascii=False)};
    try {{
      if (window.opener) {{
        window.opener.postMessage(payload, window.location.origin);
      }}
    }} catch (e) {{}}
    setTimeout(() => window.close(), 200);
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)


# --- Proxy ---

@app.post("/v1/messages")
async def messages_endpoint(request: Request):
    proxy_key = _get_proxy_key(request)
    if not proxy_key:
        return _err("Invalid API key", 401)
    return await do_proxy(request, key_mgr, log_mgr, auto_continue=proxy_key.auto_continue)


@app.get("/v1/models")
async def models_endpoint():
    return {
        "object": "list",
        "data": [{"id": m["id"], "object": "model", "created": 0, "owned_by": "gitlab-duo"} for m in MODELS],
    }


# --- GitLab Key CRUD ---

class AddKeyReq(BaseModel):
    name: str
    pat: str


class UpdateKeyReq(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    weight: int | None = None


class ReorderReq(BaseModel):
    key_ids: list[str]


@app.get("/api/keys")
async def list_keys(request: Request):
    if err := _verify_admin(request):
        return err
    return [_serialize_key(k) for k in sorted(config_mgr.config.keys, key=lambda x: x.order)]


@app.post("/api/keys")
async def add_key(request: Request, req: AddKeyReq):
    if err := _verify_admin(request):
        return err
    key = config_mgr.add_key(req.name, req.pat)
    try:
        await key_mgr.get_token(key.pat)
    except Exception:
        pass
    return _serialize_key(key)


class BatchImportReq(BaseModel):
    text: str  # one PAT per line, optional "name:pat" format


@app.post("/api/keys/batch-import")
async def batch_import(request: Request, req: BatchImportReq):
    if err := _verify_admin(request):
        return err
    added = 0
    skipped = 0
    new_keys = []
    seen_pats: set[str] = set()
    for i, line in enumerate(req.text.strip().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        if ":" in line and not line.startswith("glpat-"):
            name, pat = line.split(":", 1)
            name, pat = name.strip(), pat.strip()
        else:
            name, pat = f"Key {len(config_mgr.config.keys) + 1}", line
        if not pat:
            continue
        if pat in seen_pats or any(k.pat == pat for k in config_mgr.config.keys):
            skipped += 1
            continue
        seen_pats.add(pat)
        key = config_mgr.add_key(name, pat)
        new_keys.append(key)
        added += 1
    for key in new_keys:
        try:
            await key_mgr.get_token(key.pat)
        except Exception:
            pass
    return {"added": added, "skipped": skipped, "total": len(config_mgr.config.keys)}


@app.get("/api/keys/export")
async def export_keys(request: Request):
    if err := _verify_admin(request):
        return err
    pats = [k.pat for k in sorted(config_mgr.config.keys, key=lambda x: x.order) if k.auth_type == "pat" and k.pat]
    return Response(content="\n".join(pats), media_type="text/plain")


class BatchTestReq(BaseModel):
    model: str | None = None


@app.post("/api/keys/batch-test")
async def batch_test(request: Request, req: BatchTestReq):
    if err := _verify_admin(request):
        return err
    model = req.model or config_mgr.config.settings.test_model
    keys = [k for k in config_mgr.config.keys if k.enabled]
    results = []
    for key in keys:
        valid, message, ttl = await key_mgr.validate_key(key, model=model)
        results.append({"id": key.id, "name": key.name, "valid": valid, "message": message, "token_ttl": ttl})
    return results


@app.post("/api/keys/reorder")
async def reorder_keys(request: Request, req: ReorderReq):
    if err := _verify_admin(request):
        return err
    config_mgr.reorder_keys(req.key_ids)
    return {"ok": True}


@app.put("/api/keys/{key_id}")
async def update_key(key_id: str, request: Request, req: UpdateKeyReq):
    if err := _verify_admin(request):
        return err
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    key = config_mgr.update_key(key_id, **fields)
    if not key:
        return _err("Key not found", 404)
    return _serialize_key(key)


@app.delete("/api/keys/{key_id}")
async def delete_key(key_id: str, request: Request):
    if err := _verify_admin(request):
        return err
    key = next((k for k in config_mgr.config.keys if k.id == key_id), None)
    if key and config_mgr.remove_key(key_id):
        key_mgr.cleanup_key(key_id, key.pat)
        return {"ok": True}
    return _err("Key not found", 404)


class TestKeyReq(BaseModel):
    model: str | None = None


@app.post("/api/keys/{key_id}/test")
async def test_key(key_id: str, request: Request, req: TestKeyReq):
    if err := _verify_admin(request):
        return err
    key = next((k for k in config_mgr.config.keys if k.id == key_id), None)
    if not key:
        return _err("Key not found", 404)
    model = req.model or config_mgr.config.settings.test_model
    valid, message, token_ttl = await key_mgr.validate_key(key, model=model)
    return {"valid": valid, "message": message, "token_ttl": token_ttl}


@app.post("/api/keys/{key_id}/restore")
async def restore_key(key_id: str, request: Request):
    if err := _verify_admin(request):
        return err
    key = key_mgr.restore_key(key_id)
    if not key:
        return _err("Key not found", 404)
    return _serialize_key(key)


# --- Proxy API Keys CRUD ---

class AddApiKeyReq(BaseModel):
    name: str


@app.get("/api/api-keys")
async def list_api_keys(request: Request):
    if err := _verify_admin(request):
        return err
    return [{"id": k.id, "name": k.name, "key": k.key, "auto_continue": k.auto_continue, "created_at": k.created_at} for k in config_mgr.config.settings.api_keys]


@app.post("/api/api-keys")
async def add_api_key(request: Request, req: AddApiKeyReq):
    if err := _verify_admin(request):
        return err
    entry = config_mgr.add_api_key(req.name)
    return entry.model_dump()


@app.delete("/api/api-keys/{key_id}")
async def delete_api_key(key_id: str, request: Request):
    if err := _verify_admin(request):
        return err
    if config_mgr.remove_api_key(key_id):
        return {"ok": True}
    return _err("Key not found", 404)


class UpdateApiKeyReq(BaseModel):
    auto_continue: bool | None = None


@app.put("/api/api-keys/{key_id}")
async def update_api_key(key_id: str, request: Request, req: UpdateApiKeyReq):
    if err := _verify_admin(request):
        return err
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    entry = config_mgr.update_api_key(key_id, **fields)
    if not entry:
        return _err("Key not found", 404)
    return {"id": entry.id, "name": entry.name, "key": entry.key, "auto_continue": entry.auto_continue, "created_at": entry.created_at}


# --- Settings ---

class UpdateSettingsReq(BaseModel):
    rotation_mode: str | None = None
    max_retries: int | None = None
    blacklist_threshold: int | None = None
    validation_interval: int | None = None
    max_continuations: int | None = None
    max_tokens_cap: int | None = None
    test_model: str | None = None
    gitlab_url: str | None = None
    anthropic_proxy: str | None = None
    gitlab_oauth_client_id: str | None = None
    gitlab_oauth_client_secret: str | None = None
    gitlab_oauth_redirect_uri: str | None = None


def _settings_dict(s) -> dict:
    return {
        "rotation_mode": s.rotation_mode,
        "max_retries": s.max_retries,
        "blacklist_threshold": s.blacklist_threshold,
        "validation_interval": s.validation_interval,
        "max_continuations": s.max_continuations,
        "max_tokens_cap": s.max_tokens_cap,
        "test_model": s.test_model,
        "gitlab_url": s.gitlab_url,
        "anthropic_proxy": s.anthropic_proxy,
        "gitlab_oauth_client_id": s.gitlab_oauth_client_id,
        "gitlab_oauth_client_secret": s.gitlab_oauth_client_secret,
        "gitlab_oauth_redirect_uri": s.gitlab_oauth_redirect_uri,
    }


@app.get("/api/settings")
async def get_settings(request: Request):
    if err := _verify_admin(request):
        return err
    return _settings_dict(config_mgr.config.settings)


@app.put("/api/settings")
async def update_settings(request: Request, req: UpdateSettingsReq):
    if err := _verify_admin(request):
        return err
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    return _settings_dict(config_mgr.update_settings(**fields))


# --- Stats ---

@app.get("/api/stats")
async def get_stats(request: Request):
    if err := _verify_admin(request):
        return err
    return key_mgr.get_stats()


@app.get("/api/logs")
async def get_logs(request: Request, limit: int = 100, offset: int = 0):
    if err := _verify_admin(request):
        return err
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    return {"entries": log_mgr.get_recent(limit, offset), "total": log_mgr.total}


# --- Health ---

@app.get("/health")
async def health():
    return {"status": "ok"}


# --- Static frontend ---

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        file = STATIC_DIR / path
        if file.exists() and file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")

if __name__ == "__main__":
    import os, uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "22341")))
