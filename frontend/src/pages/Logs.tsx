import { useEffect, useState } from "react"
import { useToast } from "../components/Toast"
import { fetchLogs, getErrorMessage, type LogEntry, type LogsResponse } from "../api"

export default function Logs() {
  const [data, setData] = useState<LogsResponse>({ entries: [], total: 0 })
  const { toast } = useToast()

  useEffect(() => {
    let disposed = false
    let active: AbortController | null = null
    const load = async (showError: boolean) => {
      active?.abort()
      const ctrl = active = new AbortController()
      try {
        const res = await fetchLogs(100, 0, ctrl.signal)
        if (!disposed) setData(res)
      } catch (e) {
        if (showError && !ctrl.signal.aborted && !disposed) toast(getErrorMessage(e), "error")
      }
    }
    void load(true)
    const timer = setInterval(() => void load(false), 3000)
    return () => { disposed = true; clearInterval(timer); active?.abort() }
  }, [toast])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 kawaii-gradient-text">{"\u{1F4CB} \u8BF7\u6C42\u65E5\u5FD7"}</h1>
      <div className="bg-white rounded-kawaii-lg p-6 shadow-kawaii-md">
        <div className="text-sm text-kawaii-text-lt mb-4">
          {"\u5171 "}{data.total}{" \u6761\u8BB0\u5F55\uFF08\u663E\u793A\u6700\u8FD1 "}{data.entries.length}{" \u6761\uFF0C\u6BCF 3s \u81EA\u52A8\u5237\u65B0\uFF09"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-kawaii-text-md border-b">
                <th className="pb-2 pr-3">{"\u65F6\u95F4"}</th>
                <th className="pb-2 pr-3">{"\u5BC6\u94A5"}</th>
                <th className="pb-2 pr-3">{"\u6A21\u578B"}</th>
                <th className="pb-2 pr-3">{"\u72B6\u6001"}</th>
                <th className="pb-2 pr-3">{"\u8017\u65F6"}</th>
                <th className="pb-2 pr-3">{"\u8F93\u5165"}</th>
                <th className="pb-2 pr-3">{"\u8F93\u51FA"}</th>
                <th className="pb-2 pr-3">{"\u6D41\u5F0F"}</th>
                <th className="pb-2">{"\u9519\u8BEF"}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <LogRow key={`${e.timestamp}-${i}`} entry={e} />
              ))}
              {data.entries.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-kawaii-text-lt">{"\u6682\u65E0\u65E5\u5FD7"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function LogRow({ entry: e }: { entry: LogEntry }) {
  const time = new Date(e.timestamp * 1000)
  const timeStr = [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join(":")
  const statusColor = e.status >= 200 && e.status < 400 ? "text-green-600" : "text-red-500"

  return (
    <tr className="border-b border-kawaii-cream/50 hover:bg-kawaii-cream/30 transition-colors">
      <td className="py-1.5 pr-3 text-kawaii-text-lt whitespace-nowrap">{timeStr}</td>
      <td className="py-1.5 pr-3 font-medium">{e.key_name || e.key_id.slice(0, 8)}</td>
      <td className="py-1.5 pr-3 text-kawaii-text-md">{shortModel(e.model)}</td>
      <td className={`py-1.5 pr-3 font-mono ${statusColor}`}>{e.status}</td>
      <td className="py-1.5 pr-3 text-kawaii-text-md">{e.duration_ms}ms</td>
      <td className="py-1.5 pr-3">{e.input_tokens}</td>
      <td className="py-1.5 pr-3">{e.output_tokens}</td>
      <td className="py-1.5 pr-3">{e.is_stream ? "\u2713" : ""}</td>
      <td className="py-1.5 text-red-400 truncate max-w-[200px]">{e.error}</td>
    </tr>
  )
}

function shortModel(model: string): string {
  return model.replace("claude-", "").replace(/-\d{8}$/, "")
}
