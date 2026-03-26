import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field, model_validator

DATA_DIR = Path(__file__).parent / "data"
CONFIG_FILE = DATA_DIR / "config.json"
ENV_FILE = Path(__file__).parent / ".env"


def _load_dotenv():
    """Load .env file into os.environ (simple parser, no dependency)."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


class KeyConfig(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    auth_type: str = "pat"  # "pat" | "oauth"
    pat: str = ""
    oauth_access_token: str = ""
    oauth_refresh_token: str = ""
    oauth_expires_at: float = 0
    gitlab_user_id: int | None = None
    gitlab_username: str = ""
    gitlab_email: str = ""
    enabled: bool = True
    order: int = 0
    weight: int = 1
    status: str = "active"  # "active" | "invalid"
    failure_count: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ApiKeyEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    key: str = Field(default_factory=lambda: f"sk-gd-{secrets.token_hex(24)}")
    auto_continue: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Settings(BaseModel):
    rotation_mode: str = "weighted_round_robin"  # "round_robin" | "weighted_round_robin" | "ordered_fallback"
    max_retries: int = 2
    blacklist_threshold: int = 5
    validation_interval: int = 5  # minutes
    max_continuations: int = 3  # auto-continue on stream truncation
    max_tokens_cap: int = 4096  # cap client max_tokens to prevent GitLab ~93s timeout
    test_model: str = "claude-sonnet-4-6"
    api_keys: list[ApiKeyEntry] = []
    admin_password: str = ""
    gitlab_url: str = "https://gitlab.com"
    anthropic_proxy: str = "https://cloud.gitlab.com/ai/v1/proxy/anthropic"
    gitlab_oauth_client_id: str = ""
    gitlab_oauth_client_secret: str = ""
    gitlab_oauth_redirect_uri: str = ""

    @model_validator(mode="before")
    @classmethod
    def _migrate(cls, data):
        if isinstance(data, dict) and "proxy_api_key" in data:
            old_key = data.pop("proxy_api_key")
            if "api_keys" not in data or not data["api_keys"]:
                data["api_keys"] = [{"name": "Default", "key": old_key}]
        return data


class AppConfig(BaseModel):
    keys: list[KeyConfig] = []
    settings: Settings = Field(default_factory=Settings)


class ConfigManager:
    def __init__(self):
        self.admin_password_source = "unset"
        self.config = self._load()

    def _load(self) -> AppConfig:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if CONFIG_FILE.exists():
            cfg = AppConfig.model_validate_json(CONFIG_FILE.read_text(encoding="utf-8"))
        else:
            cfg = AppConfig()
        # .env ADMIN_PASSWORD overrides config
        env_pw = os.environ.get("ADMIN_PASSWORD")
        if env_pw:
            cfg.settings.admin_password = env_pw
            self.admin_password_source = ".env"
        elif cfg.settings.admin_password:
            self.admin_password_source = "config"
        self._save(cfg)
        return cfg

    def _save(self, cfg: AppConfig | None = None):
        if cfg is None:
            cfg = self.config
        # Don't persist env-sourced admin password to disk
        env_pw = ""
        if self.admin_password_source == ".env":
            env_pw = cfg.settings.admin_password
            cfg.settings.admin_password = ""
        CONFIG_FILE.write_text(cfg.model_dump_json(indent=2), encoding="utf-8")
        if env_pw:
            cfg.settings.admin_password = env_pw

    @property
    def login_setup_required(self) -> bool:
        return not bool(self.config.settings.admin_password.strip())

    @property
    def can_persist_admin_password(self) -> bool:
        return self.admin_password_source != ".env"

    def set_admin_password(self, password: str) -> str:
        password = password.strip()
        if not password:
            raise ValueError("管理密码不能为空")
        self.config.settings.admin_password = password
        self.admin_password_source = "config"
        self._save()
        return password

    def verify_admin_password(self, password: str) -> bool:
        return password.strip() == self.config.settings.admin_password

    def change_admin_password(self, current_password: str, new_password: str) -> str:
        if not self.can_persist_admin_password:
            raise ValueError("当前管理密码由环境变量控制，无法写入 config.json")
        if not self.verify_admin_password(current_password):
            raise ValueError("当前密码不正确")
        return self.set_admin_password(new_password)

    def add_key(self, name: str, pat: str) -> KeyConfig:
        order = max((k.order for k in self.config.keys), default=-1) + 1
        key = KeyConfig(name=name, auth_type="pat", pat=pat, order=order)
        self.config.keys.append(key)
        self._save()
        return key

    def add_oauth_key(
        self,
        name: str,
        access_token: str,
        refresh_token: str,
        expires_at: float,
        gitlab_user_id: int | None,
        gitlab_username: str,
        gitlab_email: str,
    ) -> KeyConfig:
        order = max((k.order for k in self.config.keys), default=-1) + 1
        key = KeyConfig(
            name=name,
            auth_type="oauth",
            oauth_access_token=access_token,
            oauth_refresh_token=refresh_token,
            oauth_expires_at=expires_at,
            gitlab_user_id=gitlab_user_id,
            gitlab_username=gitlab_username,
            gitlab_email=gitlab_email,
            order=order,
        )
        self.config.keys.append(key)
        self._save()
        return key

    def find_oauth_key_by_user(self, gitlab_user_id: int | None, gitlab_username: str) -> KeyConfig | None:
        for key in self.config.keys:
            if key.auth_type != "oauth":
                continue
            if gitlab_user_id is not None and key.gitlab_user_id == gitlab_user_id:
                return key
            if gitlab_username and key.gitlab_username == gitlab_username:
                return key
        return None

    @property
    def gitlab_oauth_client_id(self) -> str:
        return self.config.settings.gitlab_oauth_client_id.strip() or os.environ.get("GITLAB_OAUTH_CLIENT_ID", "").strip()

    @property
    def gitlab_oauth_client_secret(self) -> str:
        return self.config.settings.gitlab_oauth_client_secret.strip() or os.environ.get("GITLAB_OAUTH_CLIENT_SECRET", "").strip()

    @property
    def gitlab_oauth_redirect_uri(self) -> str:
        return self.config.settings.gitlab_oauth_redirect_uri.strip() or os.environ.get("GITLAB_OAUTH_REDIRECT_URI", "").strip()

    @property
    def gitlab_oauth_configured(self) -> bool:
        return bool(self.gitlab_oauth_client_id and self.gitlab_oauth_client_secret)

    def remove_key(self, key_id: str) -> bool:
        before = len(self.config.keys)
        self.config.keys = [k for k in self.config.keys if k.id != key_id]
        if len(self.config.keys) < before:
            self._save()
            return True
        return False

    def update_key(self, key_id: str, **fields) -> KeyConfig | None:
        for k in self.config.keys:
            if k.id == key_id:
                for field, value in fields.items():
                    if hasattr(k, field):
                        setattr(k, field, value)
                self._save()
                return k
        return None

    def reorder_keys(self, key_ids: list[str]):
        id_map = {k.id: k for k in self.config.keys}
        reordered = []
        for i, kid in enumerate(key_ids):
            if kid in id_map:
                id_map[kid].order = i
                reordered.append(id_map.pop(kid))
        for k in id_map.values():
            k.order = len(reordered)
            reordered.append(k)
        self.config.keys = reordered
        self._save()

    def update_settings(self, **fields) -> Settings:
        for field, value in fields.items():
            if hasattr(self.config.settings, field):
                setattr(self.config.settings, field, value)
        self._save()
        return self.config.settings

    def add_api_key(self, name: str) -> ApiKeyEntry:
        entry = ApiKeyEntry(name=name)
        self.config.settings.api_keys.append(entry)
        self._save()
        return entry

    def remove_api_key(self, key_id: str) -> bool:
        before = len(self.config.settings.api_keys)
        self.config.settings.api_keys = [k for k in self.config.settings.api_keys if k.id != key_id]
        if len(self.config.settings.api_keys) < before:
            self._save()
            return True
        return False

    def find_api_key(self, key_value: str) -> ApiKeyEntry | None:
        return next((k for k in self.config.settings.api_keys if k.key == key_value), None)

    def update_api_key(self, key_id: str, **fields) -> ApiKeyEntry | None:
        for k in self.config.settings.api_keys:
            if k.id == key_id:
                for field, value in fields.items():
                    if hasattr(k, field):
                        setattr(k, field, value)
                self._save()
                return k
        return None
