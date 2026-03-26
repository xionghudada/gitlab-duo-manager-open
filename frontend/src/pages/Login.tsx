import { useEffect, useState } from "react"
import { useToast } from "../components/Toast"
import { fetchLoginMeta, getErrorMessage, login, loginWithConfigSave, type LoginMeta } from "../api"

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<LoginMeta | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const data = await fetchLoginMeta()
        if (!disposed) setMeta(data)
      } catch (err) {
        if (!disposed) toast(getErrorMessage(err), "error")
      }
    })()
    return () => { disposed = true }
  }, [toast])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    try {
      const isSetupMode = !!meta?.setup_required && meta.can_save_to_config
      if (isSetupMode) {
        await loginWithConfigSave(password.trim())
        toast("管理密码已保存到 config.json")
      } else {
        await login(password.trim())
      }
      onLogin()
    } catch (err) {
      toast(getErrorMessage(err), "error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-kawaii-cream">
      <form onSubmit={handleSubmit} className="bg-white rounded-kawaii-lg shadow-kawaii-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3 animate-kawaii-float">{"\u2728"}</div>
          <h1 className="text-2xl font-bold kawaii-gradient-text">Duo Manager</h1>
          <p className="text-sm text-kawaii-text-md mt-1">
            {meta?.setup_required
              ? "\u9996\u6B21\u4F7F\u7528\uFF1A\u8BF7\u8BBE\u7F6E\u7BA1\u7406\u5BC6\u7801\uFF0C\u767B\u5F55\u540E\u4F1A\u81EA\u52A8\u5199\u5165 config.json"
              : "\u8BF7\u8F93\u5165\u7BA1\u7406\u5BC6\u7801\u767B\u5F55"}
          </p>
        </div>
        <input
          type="password"
          className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-3 text-sm focus:outline-none focus:border-kawaii-pink focus:shadow-[0_0_0_4px_rgba(255,182,217,0.2)] transition-all duration-300 mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={meta?.setup_required ? "\u8BF7\u8BBE\u7F6E\u7BA1\u7406\u5BC6\u7801" : "\u7BA1\u7406\u5BC6\u7801"}
          autoFocus
          disabled={loading}
        />
        {meta?.setup_required && !meta.can_save_to_config && (
          <div className="text-xs text-red-500 mb-4">
            {"\u5F53\u524D\u7BA1\u7406\u5BC6\u7801\u7531\u73AF\u5883\u53D8\u91CF\u63A7\u5236\uFF0C\u65E0\u6CD5\u5199\u5165 config.json"}
          </div>
        )}
        <button
          type="submit"
          className="w-full kawaii-gradient-bg py-3 rounded-full text-sm font-semibold transition-all duration-300 hover:-translate-y-1 hover:shadow-kawaii-md disabled:opacity-40"
          disabled={loading || !password.trim()}
        >
          {loading ? "\u5904\u7406\u4E2D..." : meta?.setup_required ? "\u4FDD\u5B58\u5E76\u767B\u5F55" : "\u767B\u5F55"}
        </button>
      </form>
    </div>
  )
}
