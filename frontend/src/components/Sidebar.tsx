const NAV = [
  { id: "dashboard", label: "\u4EEA\u8868\u76D8", icon: "\u{1F4CA}" },
  { id: "keys", label: "\u5BC6\u94A5\u7BA1\u7406", icon: "\u{1F511}" },
  { id: "gitlab-login", label: "GitLab \u767B\u5F55", icon: "\u{1F510}" },
  { id: "logs", label: "\u8BF7\u6C42\u65E5\u5FD7", icon: "\u{1F4CB}" },
  { id: "settings", label: "\u8BBE\u7F6E", icon: "\u2699\uFE0F" },
]

export default function Sidebar({ current, onNavigate, onLogout }: {
  current: string
  onNavigate: (p: string) => void
  onLogout: () => void
}) {
  return (
    <aside
      className="w-56 shrink-0 flex flex-col"
      style={{ background: "linear-gradient(180deg, #FFDBE9 0%, #F5EDFF 50%, #E8F8E8 100%)" }}
    >
      <div className="px-5 py-5 flex items-center gap-2.5">
        <span className="text-2xl animate-kawaii-float">{"\u2728"}</span>
        <span className="text-lg font-bold kawaii-gradient-text">Duo Manager</span>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => onNavigate(n.id)}
            className={`w-full text-left px-4 py-2.5 rounded-full flex items-center gap-3 text-sm font-medium transition-all duration-300 ${
              current === n.id
                ? "bg-white shadow-kawaii-sm text-kawaii-text"
                : "text-kawaii-text-md hover:bg-white/50"
            }`}
          >
            <span className="text-lg">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>
      <div className="px-3 pb-3">
        <button
          onClick={onLogout}
          className="w-full px-4 py-2 rounded-full text-sm text-kawaii-text-md hover:bg-white/50 transition-all duration-300 flex items-center gap-2"
        >
          <span>{"\u{1F6AA}"}</span>
          {"\u9000\u51FA\u767B\u5F55"}
        </button>
      </div>
      <div className="px-5 py-2 text-xs text-kawaii-text-lt">v0.1.0</div>
    </aside>
  )
}
