import { useState } from "react"
import type { KeyInfo } from "../api"

function formatTTL(seconds: number): string {
  if (seconds <= 0) return "\u5DF2\u8FC7\u671F"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}\u5C0F\u65F6 ${m}\u5206` : `${m}\u5206`
}

function statusLabel(k: KeyInfo): { text: string; color: string } {
  if (!k.enabled) return { text: "\u5DF2\u7981\u7528", color: "bg-gray-300" }
  if (k.status === "invalid") return { text: "\u5DF2\u5931\u6548", color: "bg-red-400" }
  if (k.has_token) return { text: "\u6D3B\u8DC3", color: "bg-kawaii-green" }
  return { text: "\u65E0 Token", color: "bg-yellow-400" }
}

function authTypeLabel(k: KeyInfo): { text: string; className: string } {
  if (k.auth_type === "oauth") {
    return { text: "OAuth", className: "border-kawaii-blue bg-kawaii-blue-light" }
  }
  return { text: "PAT", className: "border-kawaii-green bg-kawaii-green-light" }
}

export default function KeyTable({ keys, onToggle, onDelete, onTest, onRestore }: {
  keys: KeyInfo[]
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onTest: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
}) {
  const [loading, setLoading] = useState<Record<string, string>>({})

  const withLoading = async (id: string, action: string, fn: () => Promise<void>) => {
    setLoading((s) => ({ ...s, [id]: action }))
    try { await fn() } finally { setLoading((s) => { const n = { ...s }; delete n[id]; return n }) }
  }

  return (
    <div className="bg-white rounded-kawaii-lg shadow-kawaii-md overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-kawaii-pink-light/50 text-kawaii-text-md text-sm">
            <th className="px-4 py-3 text-left font-medium">{"\u540D\u79F0"}</th>
            <th className="px-4 py-3 text-left font-medium">{"\u7C7B\u578B"}</th>
            <th className="px-4 py-3 text-left font-medium">{"\u51ED\u8BC1"}</th>
            <th className="px-4 py-3 text-left font-medium">{"\u72B6\u6001"}</th>
            <th className="px-4 py-3 text-left font-medium">{"\u5931\u8D25"}</th>
            <th className="px-4 py-3 text-left font-medium">{"\u6743\u91CD"}</th>
            <th className="px-4 py-3 text-left font-medium">Token</th>
            <th className="px-4 py-3 text-right font-medium">{"\u64CD\u4F5C"}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const st = statusLabel(k)
            const auth = authTypeLabel(k)
            const busy = loading[k.id]
            return (
              <tr key={k.id} className="border-t border-kawaii-pink-light/30 hover:bg-kawaii-purple-light/30 transition-colors">
                <td className="px-4 py-3 text-sm font-medium">{k.name}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-flex px-2.5 py-1 rounded-full border-2 text-xs ${auth.className}`}>
                    {auth.text}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-kawaii-text-md">
                  <div className="font-mono">{k.credential_display || k.pat}</div>
                  {k.auth_type === "oauth" && (
                    <div className="text-xs text-kawaii-text-lt mt-1">
                      {k.gitlab_username ? `@${k.gitlab_username}` : ""}
                      {k.gitlab_email ? ` · ${k.gitlab_email}` : ""}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 text-sm">
                    <span className={`w-2.5 h-2.5 rounded-full ${st.color}`} />
                    {st.text}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-kawaii-text-md">{k.failure_count}</td>
                <td className="px-4 py-3 text-sm text-kawaii-text-md">{k.weight}</td>
                <td className="px-4 py-3 text-sm text-kawaii-text-md">{k.has_token ? formatTTL(k.token_ttl) : "-"}</td>
                <td className="px-4 py-3 text-right space-x-1">
                  <button
                    className="text-xs px-2.5 py-1 rounded-full border-2 border-kawaii-green bg-kawaii-green-light hover:bg-kawaii-green transition-all duration-300 disabled:opacity-40"
                    onClick={() => withLoading(k.id, "test", () => onTest(k.id))}
                    disabled={!!busy}
                  >{busy === "test" ? "..." : "\u6D4B\u8BD5"}</button>
                  {k.status === "invalid" && (
                    <button
                      className="text-xs px-2.5 py-1 rounded-full border-2 border-kawaii-yellow bg-kawaii-yellow hover:bg-yellow-300 transition-all duration-300 disabled:opacity-40"
                      onClick={() => withLoading(k.id, "restore", () => onRestore(k.id))}
                      disabled={!!busy}
                    >{busy === "restore" ? "..." : "\u6062\u590D"}</button>
                  )}
                  <button
                    className="text-xs px-2.5 py-1 rounded-full border-2 border-kawaii-purple bg-kawaii-purple-light hover:bg-kawaii-purple transition-all duration-300"
                    onClick={() => onToggle(k.id, !k.enabled)}
                  >{k.enabled ? "\u7981\u7528" : "\u542F\u7528"}</button>
                  <button
                    className="text-xs px-2.5 py-1 rounded-full border-2 border-kawaii-pink bg-kawaii-pink-light hover:bg-kawaii-pink transition-all duration-300"
                    onClick={() => onDelete(k.id)}
                  >{k.auth_type === "oauth" ? "\u5220\u9664 OAuth" : "\u5220\u9664 PAT"}</button>
                </td>
              </tr>
            )
          })}
          {keys.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-14 text-center text-kawaii-text-lt">
                <div className="text-4xl mb-3 animate-kawaii-float">{"\u{1F511}"}</div>
                {"\u8FD8\u6CA1\u6709\u5BC6\u94A5\uFF0C\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u6DFB\u52A0\u5427\uFF01"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
