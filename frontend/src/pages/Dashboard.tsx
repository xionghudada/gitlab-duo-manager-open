import { useEffect, useState } from "react"
import StatsCard from "../components/StatsCard"
import { useToast } from "../components/Toast"
import { fetchStats, fetchKeys, getErrorMessage, type StatsInfo, type KeyInfo } from "../api"

export default function Dashboard() {
  const [stats, setStats] = useState<StatsInfo>({
    total_requests: 0, active_keys: 0, success_rate: 100,
    total_input_tokens: 0, total_output_tokens: 0, per_key: {},
  })
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const { toast } = useToast()

  useEffect(() => {
    let disposed = false
    let active: AbortController | null = null
    const load = async (showError: boolean) => {
      active?.abort()
      const ctrl = active = new AbortController()
      try {
        const [s, k] = await Promise.all([fetchStats(ctrl.signal), fetchKeys(ctrl.signal)])
        if (!disposed) { setStats(s); setKeys(k) }
      } catch (e) {
        if (showError && !ctrl.signal.aborted && !disposed) toast(getErrorMessage(e), "error")
      }
    }
    void load(true)
    const timer = setInterval(() => void load(false), 5000)
    return () => { disposed = true; clearInterval(timer); active?.abort() }
  }, [toast])

  const keyMap = Object.fromEntries(keys.map((k) => [k.id, k.name]))
  const perKeyEntries = Object.entries(stats.per_key)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 kawaii-gradient-text">{"\u{1F4CA} \u4EEA\u8868\u76D8"}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-5 mb-8">
        <StatsCard icon={"\u{1F4E8}"} title={"\u603B\u8BF7\u6C42\u6570"} value={stats.total_requests} />
        <StatsCard icon={"\u{1F511}"} title={"\u6D3B\u8DC3\u5BC6\u94A5"} value={stats.active_keys} />
        <StatsCard icon={"\u2705"} title={"\u6210\u529F\u7387"} value={`${stats.success_rate}%`} />
        <StatsCard icon={"\u{1F4E5}"} title={"\u8F93\u5165 Tokens"} value={fmt(stats.total_input_tokens)} />
        <StatsCard icon={"\u{1F4E4}"} title={"\u8F93\u51FA Tokens"} value={fmt(stats.total_output_tokens)} />
      </div>

      {perKeyEntries.length > 0 && (
        <div className="bg-white rounded-kawaii-lg p-6 shadow-kawaii-md">
          <h2 className="text-lg font-bold mb-4 kawaii-gradient-text">{"\u{1F511} Per-Key \u7EDF\u8BA1"}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-kawaii-text-md border-b">
                  <th className="pb-2 pr-4">{"\u5BC6\u94A5"}</th>
                  <th className="pb-2 pr-4">{"\u8BF7\u6C42\u6570"}</th>
                  <th className="pb-2 pr-4">{"\u6210\u529F"}</th>
                  <th className="pb-2 pr-4">{"\u5931\u8D25"}</th>
                  <th className="pb-2 pr-4">{"\u8F93\u5165 Tokens"}</th>
                  <th className="pb-2 pr-4">{"\u8F93\u51FA Tokens"}</th>
                  <th className="pb-2">{"\u6700\u540E\u4F7F\u7528"}</th>
                </tr>
              </thead>
              <tbody>
                {perKeyEntries.map(([kid, s]) => (
                  <tr key={kid} className="border-b border-kawaii-cream/50">
                    <td className="py-2 pr-4 font-medium">{keyMap[kid] || kid.slice(0, 8)}</td>
                    <td className="py-2 pr-4">{s.total}</td>
                    <td className="py-2 pr-4 text-green-600">{s.success}</td>
                    <td className="py-2 pr-4 text-red-500">{s.failures}</td>
                    <td className="py-2 pr-4">{fmt(s.input_tokens)}</td>
                    <td className="py-2 pr-4">{fmt(s.output_tokens)}</td>
                    <td className="py-2 text-kawaii-text-lt">{s.last_used ? timeAgo(s.last_used) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return "\u521A\u521A"
  if (diff < 3600) return `${Math.floor(diff / 60)} \u5206\u949F\u524D`
  if (diff < 86400) return `${Math.floor(diff / 3600)} \u5C0F\u65F6\u524D`
  return `${Math.floor(diff / 86400)} \u5929\u524D`
}
