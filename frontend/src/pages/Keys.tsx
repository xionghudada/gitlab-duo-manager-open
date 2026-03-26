import { useEffect, useState } from "react"
import KeyTable from "../components/KeyTable"
import AddKeyDialog from "../components/AddKeyDialog"
import { useToast } from "../components/Toast"
import {
  addKey, deleteKey, fetchKeys, getErrorMessage, testKey, updateKey, restoreKey,
  batchImportKeys, batchTestKeys, exportKeys, type KeyInfo,
} from "../api"

export default function Keys() {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [filter, setFilter] = useState<"all" | "pat" | "oauth">("all")
  const [showAdd, setShowAdd] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState(false)
  const [batchText, setBatchText] = useState("")
  const [batchImporting, setBatchImporting] = useState(false)
  const [batchTesting, setBatchTesting] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let disposed = false
    const controllers = new Set<AbortController>()
    const poll = async (showError: boolean) => {
      const ctrl = new AbortController()
      controllers.add(ctrl)
      try {
        const data = await fetchKeys(ctrl.signal)
        if (!disposed) setKeys(data)
      } catch (e) {
        if (showError && !ctrl.signal.aborted && !disposed) toast(getErrorMessage(e), "error")
      } finally { controllers.delete(ctrl) }
    }
    void poll(true)
    const timer = setInterval(() => void poll(false), 5000)
    return () => { disposed = true; clearInterval(timer); controllers.forEach((c) => c.abort()) }
  }, [toast])

  const reload = async () => { try { setKeys(await fetchKeys()) } catch { /* polling will recover */ } }

  const handleAdd = async (name: string, pat: string) => {
    try { await addKey(name, pat); toast("\u5BC6\u94A5\u5DF2\u6DFB\u52A0") } catch (e) { toast(getErrorMessage(e), "error"); throw e }
    await reload()
  }
  const handleToggle = async (id: string, enabled: boolean) => {
    try { await updateKey(id, { enabled }); toast(enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u7981\u7528"); await reload() }
    catch (e) { toast(getErrorMessage(e), "error") }
  }
  const handleDelete = async (id: string) => {
    const target = keys.find((k) => k.id === id)
    const label = target?.auth_type === "oauth" ? "删除该 OAuth 账号？" : "确定删除该 PAT？"
    if (!confirm(label)) return
    try { await deleteKey(id); toast("\u5DF2\u5220\u9664"); await reload() }
    catch (e) { toast(getErrorMessage(e), "error") }
  }
  const handleTest = async (id: string) => {
    try {
      const res = await testKey(id)
      toast(res.message, res.valid ? "success" : "error")
      await reload()
    } catch (e) { toast(getErrorMessage(e), "error") }
  }
  const handleRestore = async (id: string) => {
    try { await restoreKey(id); toast("\u5BC6\u94A5\u5DF2\u6062\u590D"); await reload() }
    catch (e) { toast(getErrorMessage(e), "error") }
  }

  const handleBatchImport = async () => {
    if (!batchText.trim()) return
    setBatchImporting(true)
    try {
      const res = await batchImportKeys(batchText)
      const parts = [`已添加 ${res.added} 个`]
      if (res.skipped > 0) parts.push(`跳过 ${res.skipped} 个重复`)
      toast(parts.join("，"))
      setBatchText(""); setShowBatchImport(false); await reload()
    } catch (e) { toast(getErrorMessage(e), "error") }
    finally { setBatchImporting(false) }
  }

  const handleBatchTest = async () => {
    setBatchTesting(true)
    try {
      const results = await batchTestKeys()
      const ok = results.filter((r) => r.valid).length
      const fail = results.length - ok
      toast(`\u6279\u91CF\u6D4B\u8BD5\u5B8C\u6210\uFF1A${ok} \u6210\u529F\uFF0C${fail} \u5931\u8D25`)
      await reload()
    } catch (e) { toast(getErrorMessage(e), "error") }
    finally { setBatchTesting(false) }
  }

  const handleExport = async () => {
    try {
      const text = await exportKeys()
      if (!text.trim()) { toast("没有可导出的密钥", "error"); return }
      const blob = new Blob([text], { type: "text/plain" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = "gitlab-pats.txt"
      a.click()
      URL.revokeObjectURL(a.href)
      toast("已导出")
    } catch (e) { toast(getErrorMessage(e), "error") }
  }

  const counts = {
    all: keys.length,
    pat: keys.filter((k) => k.auth_type === "pat").length,
    oauth: keys.filter((k) => k.auth_type === "oauth").length,
  }
  const filteredKeys = keys.filter((k) => filter === "all" || k.auth_type === filter)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold kawaii-gradient-text">{"\u{1F511} \u5BC6\u94A5\u7BA1\u7406"}</h1>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded-full text-sm border-2 border-kawaii-purple bg-kawaii-purple-light hover:bg-kawaii-purple transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-40"
            onClick={() => void handleBatchTest()} disabled={batchTesting || keys.length === 0}
          >{batchTesting ? "\u6D4B\u8BD5\u4E2D..." : "\u{1F9EA} \u6279\u91CF\u6D4B\u8BD5"}</button>
          <button
            className="px-4 py-2 rounded-full text-sm border-2 border-kawaii-blue bg-kawaii-blue-light hover:bg-kawaii-blue transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => void handleExport()} disabled={counts.pat === 0}
          >{"\u{1F4E4} \u5BFC\u51FA PAT"}</button>
          <button
            className="px-4 py-2 rounded-full text-sm border-2 border-kawaii-green bg-kawaii-green-light hover:bg-kawaii-green transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => setShowBatchImport(true)}
          >{"\u{1F4E5} \u6279\u91CF\u5BFC\u5165"}</button>
          <button
            className="kawaii-gradient-bg px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 hover:-translate-y-1 hover:shadow-kawaii-md"
            onClick={() => setShowAdd(true)}
          >{"\u2728 \u6DFB\u52A0\u5BC6\u94A5"}</button>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        {[
          { id: "all", label: `全部 (${counts.all})` },
          { id: "pat", label: `PAT (${counts.pat})` },
          { id: "oauth", label: `OAuth (${counts.oauth})` },
        ].map((item) => (
          <button
            key={item.id}
            className={`px-4 py-2 rounded-full text-sm border-2 transition-all duration-300 ${
              filter === item.id
                ? "border-kawaii-purple bg-kawaii-purple-light"
                : "border-kawaii-pink-light bg-white hover:bg-kawaii-cream"
            }`}
            onClick={() => setFilter(item.id as "all" | "pat" | "oauth")}
          >
            {item.label}
          </button>
        ))}
      </div>
      <KeyTable keys={filteredKeys} onToggle={handleToggle} onDelete={handleDelete} onTest={handleTest} onRestore={handleRestore} />
      <AddKeyDialog open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />

      {/* Batch Import Dialog */}
      {showBatchImport && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => !batchImporting && setShowBatchImport(false)}>
          <div className="bg-white rounded-kawaii-lg p-7 w-full max-w-lg shadow-kawaii-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4 kawaii-gradient-text">{"\u{1F4E5} \u6279\u91CF\u5BFC\u5165\u5BC6\u94A5"}</h2>
            <p className="text-xs text-kawaii-text-lt mb-3">{"\u6BCF\u884C\u4E00\u4E2A PAT\uFF0C\u652F\u6301\u201C\u540D\u79F0:PAT\u201D\u683C\u5F0F\u3002\u91CD\u590D\u7684 PAT \u4F1A\u81EA\u52A8\u8DF3\u8FC7\u3002"}</p>
            <textarea
              className="w-full h-40 bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-3 text-sm font-mono focus:outline-none focus:border-kawaii-pink transition-all duration-300 resize-none"
              value={batchText} onChange={(e) => setBatchText(e.target.value)}
              placeholder={"My Key 1:glpat-xxxxxxxxxxxx\nglpat-yyyyyyyyyyyy\nBackup:glpat-zzzzzzzzzzzz"}
              disabled={batchImporting} autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button className="px-5 py-2 rounded-full text-sm border-2 border-kawaii-pink text-kawaii-text-md hover:bg-kawaii-pink-light transition-all" onClick={() => setShowBatchImport(false)} disabled={batchImporting}>
                {"\u53D6\u6D88"}
              </button>
              <button
                className="kawaii-gradient-bg px-5 py-2 rounded-full text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-kawaii-sm disabled:opacity-40"
                onClick={() => void handleBatchImport()} disabled={batchImporting || !batchText.trim()}
              >{batchImporting ? "\u5BFC\u5165\u4E2D..." : "\u5BFC\u5165"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
