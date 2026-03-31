export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败"
}

const AUTH_TOKEN_KEY = "auth_token"

function getToken(): string | null {
  const sessionToken = sessionStorage.getItem(AUTH_TOKEN_KEY)
  if (sessionToken) return sessionToken
  const legacyToken = localStorage.getItem(AUTH_TOKEN_KEY)
  if (legacyToken) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, legacyToken)
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
  return legacyToken
}

function setToken(token: string) {
  sessionStorage.setItem(AUTH_TOKEN_KEY, token)
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function logout() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

async function request<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers: { ...headers, ...options?.headers } })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/login") {
      logout()
      location.reload()
    }
    const msg =
      (typeof data === "object" && data !== null && "error" in data
        ? (data as { error?: { message?: string } }).error?.message
        : null) || res.statusText || `请求失败 (${res.status})`
    throw new ApiError(msg, res.status)
  }
  return data as T
}

// --- Auth ---
export const login = async (password: string) => {
  const res = await request<{ token: string; setup_completed?: boolean }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  })
  setToken(res.token)
  return res
}

export const fetchLoginMeta = () => request<LoginMeta>("/api/login/meta")

export const loginWithConfigSave = async (password: string) => {
  const res = await request<{ token: string; setup_completed?: boolean }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ password, save_to_config: true }),
  })
  setToken(res.token)
  return res
}

export const fetchAdminPasswordMeta = () => request<AdminPasswordMeta>("/api/admin-password/meta")

export const changeAdminPassword = async (currentPassword: string, newPassword: string) => {
  const res = await request<{ token: string; password_source: string }>("/api/admin-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  setToken(res.token)
  return res
}

export const gitlabLoginImport = (pat: string, name?: string) =>
  request<GitLabLoginResult>("/api/gitlab/login", {
    method: "POST",
    body: JSON.stringify({ pat, name }),
  })

export const fetchGitLabOAuthMeta = () => request<GitLabOAuthMeta>("/api/gitlab/oauth/meta")

export const startGitLabOAuth = () =>
  request<{ authorize_url: string }>("/api/gitlab/oauth/start", { method: "POST", body: "{}" })

// --- GitLab Keys ---
export const fetchKeys = (signal?: AbortSignal) => request<KeyInfo[]>("/api/keys", { signal })
export const addKey = (name: string, pat: string) =>
  request("/api/keys", { method: "POST", body: JSON.stringify({ name, pat }) })
export const updateKey = (id: string, data: Record<string, unknown>) =>
  request(`/api/keys/${id}`, { method: "PUT", body: JSON.stringify(data) })
export const deleteKey = (id: string) => request(`/api/keys/${id}`, { method: "DELETE" })
export const reorderKeys = (keyIds: string[]) =>
  request("/api/keys/reorder", { method: "POST", body: JSON.stringify({ key_ids: keyIds }) })
export const testKey = (id: string) =>
  request<TestKeyResult>(`/api/keys/${id}/test`, { method: "POST", body: "{}" })
export const restoreKey = (id: string) =>
  request(`/api/keys/${id}/restore`, { method: "POST" })
export const batchImportKeys = (text: string) =>
  request<{ added: number; skipped: number; total: number }>("/api/keys/batch-import", { method: "POST", body: JSON.stringify({ text }) })
export const batchTestKeys = () =>
  request<TestKeyResult[]>("/api/keys/batch-test", { method: "POST", body: "{}" })
export const exportKeys = async (): Promise<string> => {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch("/api/keys/export", { headers })
  if (!res.ok) throw new ApiError(res.statusText, res.status)
  return res.text()
}

// --- Proxy API Keys ---
export const fetchApiKeys = () => request<ApiKeyInfo[]>("/api/api-keys")
export const addApiKey = (name: string) =>
  request<ApiKeyInfo>("/api/api-keys", { method: "POST", body: JSON.stringify({ name }) })
export const deleteApiKey = (id: string) => request(`/api/api-keys/${id}`, { method: "DELETE" })
export const updateApiKey = (id: string, data: Record<string, unknown>) =>
  request<ApiKeyInfo>(`/api/api-keys/${id}`, { method: "PUT", body: JSON.stringify(data) })

// --- Settings ---
export const fetchSettings = (signal?: AbortSignal) => request<SettingsInfo>("/api/settings", { signal })
export const updateSettings = (data: Record<string, unknown>) =>
  request<SettingsInfo>("/api/settings", { method: "PUT", body: JSON.stringify(data) })

// --- Stats ---
export const fetchStats = (signal?: AbortSignal) => request<StatsInfo>("/api/stats", { signal })

// --- Logs ---
export const fetchLogs = (limit = 100, offset = 0, signal?: AbortSignal) =>
  request<LogsResponse>(`/api/logs?limit=${limit}&offset=${offset}`, { signal })

// --- Types ---
export type KeyInfo = {
  id: string; name: string; pat: string; enabled: boolean
  auth_type: string; credential_display?: string
  order: number; weight: number; status: string; failure_count: number
  gitlab_username?: string; gitlab_email?: string
  created_at: string; has_token: boolean; token_ttl: number
}

export type ApiKeyInfo = {
  id: string; name: string; key: string; auto_continue: boolean; created_at: string
}

export type TestKeyResult = {
  id?: string; name?: string; valid: boolean; message: string; token_ttl: number
}

export type SettingsInfo = {
  rotation_mode: string; max_retries: number; blacklist_threshold: number
  validation_interval: number; max_continuations: number; max_tokens_cap: number
  test_model: string; gitlab_url: string; anthropic_proxy: string
  gitlab_oauth_client_id: string; gitlab_oauth_client_secret_configured: boolean; gitlab_oauth_redirect_uri: string
}

export type StatsInfo = {
  total_requests: number; active_keys: number; success_rate: number
  total_input_tokens: number; total_output_tokens: number
  per_key: Record<string, {
    total: number; success: number; failures: number
    input_tokens: number; output_tokens: number; last_used: number
  }>
}

export type LogEntry = {
  timestamp: number; key_id: string; key_name: string; model: string
  status: number; duration_ms: number; input_tokens: number; output_tokens: number
  is_stream: boolean; error: string
}

export type LogsResponse = {
  entries: LogEntry[]; total: number
}

export type LoginMeta = {
  setup_required: boolean
  can_save_to_config: boolean
  password_source: string
}

export type AdminPasswordMeta = {
  can_update: boolean
  password_source: string
}

export type GitLabLoginResult = {
  key: KeyInfo
  account: {
    id: number | null
    username: string
    name: string
    email: string
    avatar_url: string
    web_url: string
  }
  token_ttl: number
  message: string
}

export type GitLabOAuthMeta = {
  configured: boolean
  gitlab_url: string
  redirect_uri: string
}
