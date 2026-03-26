import { useState } from "react"

export default function AddKeyDialog({ open, onClose, onAdd }: {
  open: boolean
  onClose: () => void
  onAdd: (name: string, pat: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [pat, setPat] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    if (!name.trim() || !pat.trim()) return
    setSubmitting(true)
    try {
      await onAdd(name.trim(), pat.trim())
      setName("")
      setPat("")
      onClose()
    } catch { /* parent handles */ } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50" onClick={submitting ? undefined : onClose}>
      <div className="bg-white rounded-kawaii-lg p-7 w-full max-w-md shadow-kawaii-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-5 kawaii-gradient-text">{"\u2728 \u6DFB\u52A0\u5BC6\u94A5"}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-kawaii-text-md mb-1.5 font-medium">{"\u540D\u79F0"}</label>
            <input
              className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm focus:outline-none focus:border-kawaii-pink focus:shadow-[0_0_0_4px_rgba(255,182,217,0.2)] focus:-translate-y-0.5 transition-all duration-300"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={"\u4F8B\u5982\uFF1A\u4E2A\u4EBA PAT"}
              autoFocus
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-sm text-kawaii-text-md mb-1.5 font-medium">GitLab PAT</label>
            <input
              className="w-full bg-kawaii-cream border-2 border-kawaii-pink-light rounded-kawaii-md px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-kawaii-pink focus:shadow-[0_0_0_4px_rgba(255,182,217,0.2)] focus:-translate-y-0.5 transition-all duration-300"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxx"
              disabled={submitting}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="px-5 py-2.5 rounded-full text-sm border-2 border-kawaii-pink text-kawaii-text-md hover:bg-kawaii-pink-light transition-all duration-300" onClick={onClose} disabled={submitting}>
            {"\u53D6\u6D88"}
          </button>
          <button
            className="kawaii-gradient-bg px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-40 transition-all duration-300 hover:-translate-y-1 hover:shadow-kawaii-md"
            onClick={() => void handleSubmit()}
            disabled={submitting || !name.trim() || !pat.trim()}
          >
            {submitting ? "\u6DFB\u52A0\u4E2D..." : "\u2728 \u6DFB\u52A0"}
          </button>
        </div>
      </div>
    </div>
  )
}
