import { useEffect, useState } from "react"
import { useToast } from "../components/Toast"
import {
  fetchSettings, getErrorMessage, updateSettings,
  fetchApiKeys, addApiKey, deleteApiKey, updateApiKey,
  fetchAdminPasswordMeta, changeAdminPassword,
  type SettingsInfo, type ApiKeyInfo, type AdminPasswordMeta,
} from "../api"

export default function Settings() {
  const [settings, setSettings] = useState<SettingsInfo | null>(null)
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [adminPasswordMeta, setAdminPasswordMeta] = useState<AdminPasswordMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState("")
  const [savingOAuth, setSavingOAuth] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [nextPassword, setNextPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [changingPassword, setChangingPassword] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const [s, ak, apm] = await Promise.all([fetchSettings(ctrl.signal), fetchApiKeys(), fetchAdminPasswordMeta()])
        setSettings(s); setApiKeys(ak); setAdminPasswordMeta(apm)
      } catch (e) { if (!ctrl.signal.aborted) toast(getErrorMessage(e), "error") }
      finally { if (!ctrl.signal.aborted) setLoading(false) }
    })()
    return () => ctrl.abort()
  }, [toast])

  if (loading) return <div className="text-sm text-kawaii-text-md">{"\u52A0\u8F7D\u4E2D..."}</div>
  if (!settings) return <div className="text-sm text-kawaii-pink">{"\u52A0\u8F7D\u5931\u8D25"}</div>

  const save = async (fields: Record<string, unknown>) => {
    try { setSettings(await updateSettings(fields)); toast("\u5DF2\u4FDD\u5B58") }
    catch (e) { toast(getErrorMessage(e), "error") }
  }

  const handleAddApiKey = async () => {
    if (!newKeyName.trim()) return
    try {
      const entry = await addApiKey(newKeyName.trim())
      setApiKeys((p) => [...p, entry]); setNewKeyName("")
      toast("\u5DF2\u521B\u5EFA API Key")
    } catch (e) { toast(getErrorMessage(e), "error") }
  }

  const handleDeleteApiKey = async (id: string) => {
    if (!confirm("\u786E\u5B9A\u5220\u9664\uFF1F")) return
    try { await deleteApiKey(id); setApiKeys((p) => p.filter((k) => k.id !== id)); toast("\u5DF2\u5220\u9664") }
    catch (e) { toast(getErrorMessage(e), "error") }
  }

  const handleToggleAutoContinue = async (ak: ApiKeyInfo) => {
    try {
      const updated = await updateApiKey(ak.id, { auto_continue: !ak.auto_continue })
      setApiKeys((p) => p.map((k) => (k.id === ak.id ? updated : k)))
      toast(ak.auto_continue ? "已关闭代理续传" : "已开启代理续传")
    } catch (e) { toast(getErrorMessage(e), "error") }
  }

  const copyKey = async (key: string) => {
    try {
      if (navigator.clipboard) { await navigator.clipboard.writeText(key) }
      else { const t = document.createElement("textarea"); t.value = key; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t) }
      toast("\u5DF2\u590D\u5236")
    } catch (e) { toast(getErrorMessage(e), "error") }
  }

  const handleChangeAdminPassword = async () => {
    if (!currentPassword.trim() || !nextPassword.trim()) {
      toast("请填写当前密码和新密码", "error")
      return
    }
    if (nextPassword !== confirmPassword) {
      toast("两次输入的新密码不一致", "error")
      return
    }
    setChangingPassword(true)
    try {
      const res = await changeAdminPassword(currentPassword.trim(), nextPassword.trim())
      setAdminPasswordMeta({ can_update: true, password_source: res.password_source as "config" | string })
      setCurrentPassword("")
      setNextPassword("")
      setConfirmPassword("")
      toast("管理密码已更新")
    } catch (e) {
      toast(getErrorMessage(e), "error")
    } finally {
      setChangingPassword(false)
    }
  }

  const handleSaveOAuthSettings = async () => {
    if (!settings) return
    setSavingOAuth(true)
    try {
      const updated = await updateSettings({
        gitlab_oauth_client_id: settings.gitlab_oauth_client_id,
        gitlab_oauth_client_secret: settings.gitlab_oauth_client_secret,
        gitlab_oauth_redirect_uri: settings.gitlab_oauth_redirect_uri,
      })
      setSettings(updated)
      toast("OAuth 配置已保存")
    } catch (e) {
      toast(getErrorMessage(e), "error")
    } finally {
      setSavingOAuth(false)
    }
  }

  const MODES = [
    ["round_robin", "\u8F6E\u8BE2\u5747\u8861"],
    ["weighted_round_robin", "\u52A0\u6743\u8F6E\u8BE2"],
    ["ordered_fallback", "\u987A\u5E8F\u964D\u7EA7"],
  ] as const

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 kawaii-gradient-text">{"\u2699\uFE0F \u8BBE\u7F6E"}</h1>
      <div className="space-y-6 max-w-2xl">

        {/* Rotation Mode */}
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u8F6E\u8BE2\u6A21\u5F0F"}</h2>
          <div className="flex gap-2 flex-wrap">
            {MODES.map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => save({ rotation_mode: mode })}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 ${
                  settings.rotation_mode === mode
                    ? "text-kawaii-text shadow-kawaii-sm"
                    : "bg-kawaii-cream text-kawaii-text-md border-2 border-kawaii-pink-light hover:bg-kawaii-pink-light"
                }`}
                style={settings.rotation_mode === mode ? { background: "linear-gradient(135deg, #FFB6D9, #E6D5FF)" } : undefined}
              >{label}</button>
            ))}
          </div>
        </section>

        {/* Proxy Strategy */}
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u{1F6E1}\uFE0F \u4EE3\u7406\u7B56\u7565"}</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">{"\u6700\u5927\u91CD\u8BD5"}</label>
              <input type="number" min={0} max={10}
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-3 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300"
                value={settings.max_retries}
                onChange={(e) => setSettings({ ...settings, max_retries: +e.target.value })}
                onBlur={() => save({ max_retries: settings.max_retries })}
              />
            </div>
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">{"\u9ED1\u540D\u5355\u9608\u503C"}</label>
              <input type="number" min={0} max={100}
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-3 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300"
                value={settings.blacklist_threshold}
                onChange={(e) => setSettings({ ...settings, blacklist_threshold: +e.target.value })}
                onBlur={() => save({ blacklist_threshold: settings.blacklist_threshold })}
              />
            </div>
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">{"\u9A8C\u8BC1\u95F4\u9694(\u5206)"}</label>
              <input type="number" min={1} max={60}
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-3 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300"
                value={settings.validation_interval}
                onChange={(e) => setSettings({ ...settings, validation_interval: +e.target.value })}
                onBlur={() => save({ validation_interval: settings.validation_interval })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">{"\u81EA\u52A8\u7EED\u4F20\u6B21\u6570"}</label>
              <input type="number" min={0} max={10}
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-3 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300"
                value={settings.max_continuations}
                onChange={(e) => setSettings({ ...settings, max_continuations: +e.target.value })}
                onBlur={() => save({ max_continuations: settings.max_continuations })}
              />
              <span className="text-xs text-kawaii-text-lt mt-1 block">{"\u6D41\u5F0F\u622A\u65AD\u65F6\u81EA\u52A8\u7EED\u4F20\uFF0C0=\u7981\u7528"}</span>
            </div>
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">Token \u4E0A\u9650</label>
              <input type="number" min={0} max={65536}
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-3 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300"
                value={settings.max_tokens_cap}
                onChange={(e) => setSettings({ ...settings, max_tokens_cap: +e.target.value })}
                onBlur={() => save({ max_tokens_cap: settings.max_tokens_cap })}
              />
              <span className="text-xs text-kawaii-text-lt mt-1 block">{"\u9632\u6B62\u8D85\u8FC7GitLab 93s\u8D85\u65F6\uFF0C0=\u4E0D\u9650\u5236"}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 mt-4">
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">{"\u6D4B\u8BD5\u6A21\u578B"}</label>
              <select
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-3 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300 appearance-none"
                value={settings.test_model}
                onChange={(e) => { setSettings({ ...settings, test_model: e.target.value }); void save({ test_model: e.target.value }) }}
              >
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-sonnet-4-5-20250514">Claude Sonnet 4</option>
              </select>
            </div>
          </div>
        </section>

        {/* API Keys */}
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u{1F511} \u4EE3\u7406 API Key"}</h2>
          <div className="space-y-2 mb-4">
            {apiKeys.map((ak) => (
              <div key={ak.id} className="flex items-center gap-2 bg-kawaii-cream rounded-kawaii-sm p-3">
                <span className="text-sm font-medium w-24 shrink-0">{ak.name}</span>
                <code className="flex-1 text-xs font-mono text-kawaii-text-md break-all select-all">{ak.key}</code>
                <button onClick={() => void handleToggleAutoContinue(ak)}
                  className={`px-3 py-1 rounded-full text-xs border-2 transition-all shrink-0 ${ak.auto_continue ? "border-kawaii-green bg-kawaii-green-light" : "border-gray-300 bg-gray-100 text-kawaii-text-lt"}`}
                >{ak.auto_continue ? "\u7EED\u4F20" : "\u76F4\u901A"}</button>
                <button onClick={() => void copyKey(ak.key)} className="px-3 py-1 rounded-full text-xs border-2 border-kawaii-purple bg-kawaii-purple-light hover:bg-kawaii-purple transition-all shrink-0">{"\u590D\u5236"}</button>
                <button onClick={() => void handleDeleteApiKey(ak.id)} className="px-3 py-1 rounded-full text-xs border-2 border-kawaii-pink bg-kawaii-pink-light hover:bg-kawaii-pink transition-all shrink-0">{"\u5220\u9664"}</button>
              </div>
            ))}
            {apiKeys.length === 0 && <p className="text-sm text-kawaii-text-lt">{"\u8FD8\u6CA1\u6709 API Key"}</p>}
          </div>
          <div className="flex gap-2">
            <input className="flex-1 bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
              value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={"\u65B0 Key \u540D\u79F0"} onKeyDown={(e) => e.key === "Enter" && handleAddApiKey()}
            />
            <button onClick={() => void handleAddApiKey()}
              className="kawaii-gradient-bg px-5 py-2 rounded-full text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-kawaii-sm disabled:opacity-40 shrink-0"
              disabled={!newKeyName.trim()}>{"\u521B\u5EFA"}</button>
          </div>
        </section>

        {/* Admin Password */}
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u{1F512} \u7BA1\u7406\u5BC6\u7801"}</h2>
          {adminPasswordMeta && !adminPasswordMeta.can_update ? (
            <div className="text-sm text-kawaii-text-md">
              {"\u5F53\u524D\u7BA1\u7406\u5BC6\u7801\u6765\u81EA\u73AF\u5883\u53D8\u91CF "}
              <code>ADMIN_PASSWORD</code>
              {"\uFF0C\u4E0D\u80FD\u5728\u9875\u9762\u5185\u76F4\u63A5\u4FEE\u6539\u3002"}
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="password"
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={"\u5F53\u524D\u7BA1\u7406\u5BC6\u7801"}
              />
              <input
                type="password"
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={nextPassword}
                onChange={(e) => setNextPassword(e.target.value)}
                placeholder={"\u65B0\u7BA1\u7406\u5BC6\u7801"}
              />
              <input
                type="password"
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={"\u786E\u8BA4\u65B0\u7BA1\u7406\u5BC6\u7801"}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-kawaii-text-lt">
                  {"\u4FEE\u6539\u6210\u529F\u540E\uFF0C\u5F53\u524D\u767B\u5F55\u6001\u4F1A\u81EA\u52A8\u5207\u6362\u5230\u65B0\u5BC6\u7801\u3002"}
                </span>
                <button
                  onClick={() => void handleChangeAdminPassword()}
                  className="kawaii-gradient-bg px-5 py-2 rounded-full text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-kawaii-sm disabled:opacity-40 shrink-0"
                  disabled={changingPassword || !currentPassword.trim() || !nextPassword.trim() || !confirmPassword.trim()}
                >
                  {changingPassword ? "\u4FEE\u6539\u4E2D..." : "\u4FEE\u6539\u5BC6\u7801"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Endpoints */}
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u7AEF\u70B9\u914D\u7F6E"}</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">GitLab URL</label>
              <input className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={settings.gitlab_url}
                onChange={(e) => setSettings({ ...settings, gitlab_url: e.target.value })}
                onBlur={() => save({ gitlab_url: settings.gitlab_url })} />
            </div>
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">Anthropic Proxy</label>
              <input className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={settings.anthropic_proxy}
                onChange={(e) => setSettings({ ...settings, anthropic_proxy: e.target.value })}
                onBlur={() => save({ anthropic_proxy: settings.anthropic_proxy })} />
            </div>
          </div>
        </section>

        {/* GitLab OAuth */}
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u{1F310} GitLab OAuth \u914D\u7F6E"}</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">Client ID</label>
              <input
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={settings.gitlab_oauth_client_id}
                onChange={(e) => setSettings({ ...settings, gitlab_oauth_client_id: e.target.value })}
                placeholder={"GitLab OAuth Client ID"}
              />
            </div>
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">Client Secret</label>
              <input
                type="password"
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={settings.gitlab_oauth_client_secret}
                onChange={(e) => setSettings({ ...settings, gitlab_oauth_client_secret: e.target.value })}
                placeholder={"GitLab OAuth Client Secret"}
              />
            </div>
            <div>
              <label className="block text-xs text-kawaii-text-lt mb-1">Redirect URI</label>
              <input
                className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all"
                value={settings.gitlab_oauth_redirect_uri}
                onChange={(e) => setSettings({ ...settings, gitlab_oauth_redirect_uri: e.target.value })}
                placeholder={"http://localhost:22341/api/gitlab/oauth/callback"}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 mt-4">
            <span className="text-xs text-kawaii-text-lt">
              {"\u5EFA\u8BAE\u56DE\u8C03\u5730\u5740\u586B\u5199\u4E3A\u5916\u90E8\u53EF\u8BBF\u95EE\u7684 /api/gitlab/oauth/callback \u5B8C\u6574 URL\u3002"}
            </span>
            <button
              onClick={() => void handleSaveOAuthSettings()}
              className="kawaii-gradient-bg px-5 py-2 rounded-full text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-kawaii-sm disabled:opacity-40 shrink-0"
              disabled={savingOAuth}
            >
              {savingOAuth ? "\u4FDD\u5B58\u4E2D..." : "\u4FDD\u5B58 OAuth \u914D\u7F6E"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
