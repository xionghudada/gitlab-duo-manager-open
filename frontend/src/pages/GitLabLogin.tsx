import { useEffect, useRef, useState } from "react"
import { useToast } from "../components/Toast"
import { fetchGitLabOAuthMeta, getErrorMessage, gitlabLoginImport, startGitLabOAuth, type GitLabOAuthMeta } from "../api"

export default function GitLabLogin() {
  const [name, setName] = useState("")
  const [pat, setPat] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthMeta, setOauthMeta] = useState<GitLabOAuthMeta | null>(null)
  const [result, setResult] = useState<{
    username: string
    name: string
    tokenTtl: number
    source: string
  } | null>(null)
  const popupPollTimerRef = useRef<number | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    let disposed = false
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || data.type !== "gitlab-oauth-result") return
      if (data.ok) {
        setResult({
          username: data.account?.username || "",
          name: data.account?.name || "",
          tokenTtl: 0,
          source: "oauth",
        })
        toast(data.message || "GitLab OAuth 登录成功")
      } else {
        toast(data.message || "GitLab OAuth 登录失败", "error")
      }
      setOauthLoading(false)
      if (popupPollTimerRef.current) {
        window.clearInterval(popupPollTimerRef.current)
        popupPollTimerRef.current = null
      }
    }
    window.addEventListener("message", onMessage)
    ;(async () => {
      try {
        const meta = await fetchGitLabOAuthMeta()
        if (!disposed) setOauthMeta(meta)
      } catch (e) {
        if (!disposed) toast(getErrorMessage(e), "error")
      }
    })()
    return () => {
      disposed = true
      if (popupPollTimerRef.current) {
        window.clearInterval(popupPollTimerRef.current)
        popupPollTimerRef.current = null
      }
      window.removeEventListener("message", onMessage)
    }
  }, [toast])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pat.trim()) return
    setSubmitting(true)
    try {
      const res = await gitlabLoginImport(pat.trim(), name.trim())
      setResult({
        username: res.account.username,
        name: res.account.name,
        tokenTtl: res.token_ttl,
        source: "pat",
      })
      setName("")
      setPat("")
      toast(res.message)
    } catch (e) {
      toast(getErrorMessage(e), "error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleOAuthLogin = async () => {
    setOauthLoading(true)
    try {
      const res = await startGitLabOAuth()
      const popup = window.open(res.authorize_url, "gitlab-oauth-login", "width=640,height=820")
      if (!popup) {
        setOauthLoading(false)
        toast("浏览器拦截了弹窗，请允许后重试", "error")
        return
      }
      if (popupPollTimerRef.current) {
        window.clearInterval(popupPollTimerRef.current)
      }
      popupPollTimerRef.current = window.setInterval(() => {
        if (popup.closed) {
          if (popupPollTimerRef.current) {
            window.clearInterval(popupPollTimerRef.current)
            popupPollTimerRef.current = null
          }
          setOauthLoading(false)
        }
      }, 500)
    } catch (e) {
      setOauthLoading(false)
      toast(getErrorMessage(e), "error")
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6 kawaii-gradient-text">{"\u{1F511} GitLab \u767B\u5F55\u5BFC\u5165"}</h1>

      <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6 mb-6">
        <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u{1F310} GitLab OAuth Web \u767B\u5F55"}</h2>
        <p className="text-sm text-kawaii-text-md mb-4">
          {"\u70B9\u51FB\u6309\u94AE\u540E\u4F1A\u8DF3\u8F6C\u5230 GitLab \u5B98\u65B9 OAuth \u6388\u6743\u9875\u3002\u6388\u6743\u6210\u529F\u540E\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u4FDD\u5B58\u8D26\u53F7 access token / refresh token \u5230 config.json\uFF0C\u540E\u7EED\u53C2\u4E0E\u591A\u8D26\u53F7\u8F6E\u8BE2\u3002"}
        </p>
        {oauthMeta && !oauthMeta.configured && (
          <div className="text-sm text-red-500 mb-4">
            {"\u5F53\u524D\u672A\u914D\u7F6E GitLab OAuth\u3002\u8BF7\u5148\u8BBE\u7F6E GITLAB_OAUTH_CLIENT_ID \u548C GITLAB_OAUTH_CLIENT_SECRET\u3002"}
          </div>
        )}
        {oauthMeta && (
          <div className="text-xs text-kawaii-text-lt mb-4">
            <p>{`GitLab URL：${oauthMeta.gitlab_url}`}</p>
            <p>{`回调地址：${oauthMeta.redirect_uri}`}</p>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className="kawaii-gradient-bg px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-40 transition-all duration-300 hover:-translate-y-1 hover:shadow-kawaii-md"
            disabled={oauthLoading || !oauthMeta?.configured}
            onClick={() => void handleOAuthLogin()}
          >
            {oauthLoading ? "\u8DF3\u8F6C\u6388\u6743\u4E2D..." : "\u4F7F\u7528 GitLab OAuth \u767B\u5F55"}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6 mb-6">
        <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u{1F511} PAT \u624B\u52A8\u5BFC\u5165"}</h2>
        <p className="text-sm text-kawaii-text-md mb-4">
          {"\u8BF7\u8F93\u5165 GitLab PAT\u3002\u7CFB\u7EDF\u4F1A\u5148\u6821\u9A8C GitLab \u8D26\u53F7\u4FE1\u606F\uFF0C\u518D\u5C1D\u8BD5\u83B7\u53D6 Duo \u8BBF\u95EE token\uFF0C\u6700\u540E\u628A PAT \u5199\u5165 config.json\u3002"}
        </p>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm text-kawaii-text-md mb-1.5 font-medium">{"\u663E\u793A\u540D\u79F0\uFF08\u53EF\u9009\uFF09"}</label>
            <input
              className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink transition-all duration-300"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={"\u4E0D\u586B\u5219\u81EA\u52A8\u4F7F\u7528 GitLab \u7528\u6237\u540D"}
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-sm text-kawaii-text-md mb-1.5 font-medium">GitLab PAT</label>
            <input
              className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-kawaii-pink transition-all duration-300"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxx"
              autoFocus
              disabled={submitting}
            />
            <p className="text-xs text-kawaii-text-lt mt-2">
              {"\u8BF7\u4F7F\u7528\u5177\u5907 GitLab AI / Duo \u8BBF\u95EE\u6743\u9650\u7684 PAT\u3002\u4E34\u65F6 Duo token \u53EA\u4F1A\u8FDB\u884C\u5185\u5B58\u7F13\u5B58\uFF0C\u5199\u5165 config.json \u7684\u662F PAT \u672C\u8EAB\u3002"}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="kawaii-gradient-bg px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-40 transition-all duration-300 hover:-translate-y-1 hover:shadow-kawaii-md"
              disabled={submitting || !pat.trim()}
            >
              {submitting ? "\u9A8C\u8BC1\u5E76\u5199\u5165\u4E2D..." : "\u9A8C\u8BC1\u5E76\u5199\u5165 config.json"}
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="bg-white rounded-kawaii-lg shadow-kawaii-md p-6">
          <h2 className="text-sm font-semibold text-kawaii-text-md mb-3">{"\u5BFC\u5165\u7ED3\u679C"}</h2>
          <div className="space-y-2 text-sm text-kawaii-text-md">
            <p>{`\u5BFC\u5165\u65B9\u5F0F\uFF1A${result.source === "oauth" ? "GitLab OAuth" : "GitLab PAT"}`}</p>
            <p>{`\u8D26\u53F7\u540D\u79F0\uFF1A${result.name || "-"}`}</p>
            <p>{`\u7528\u6237\u540D\uFF1A${result.username || "-"}`}</p>
            <p>{`\u5F53\u524D Duo token \u6709\u6548\u671F\uFF1A${result.source === "oauth" ? "\u5DF2\u5728\u540E\u53F0\u7F13\u5B58" : formatTtl(result.tokenTtl)}`}</p>
          </div>
        </section>
      )}
    </div>
  )
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return "\u672A\u77E5"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}\u5C0F\u65F6 ${m}\u5206` : `${m}\u5206`
}
