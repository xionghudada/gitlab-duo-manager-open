import type { ReactNode } from "react"
import Sidebar from "./Sidebar"

export default function Layout({ page, onNavigate, onLogout, children }: {
  page: string
  onNavigate: (p: string) => void
  onLogout: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-screen bg-gradient-to-b from-white to-kawaii-cream text-kawaii-text">
      <Sidebar current={page} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
