import { useState } from "react"
import Layout from "./components/Layout"
import { ToastProvider } from "./components/Toast"
import Dashboard from "./pages/Dashboard"
import Keys from "./pages/Keys"
import GitLabLogin from "./pages/GitLabLogin"
import Logs from "./pages/Logs"
import Settings from "./pages/Settings"
import Login from "./pages/Login"
import { isAuthenticated, logout } from "./api"

export default function App() {
  const [page, setPage] = useState("dashboard")
  const [authed, setAuthed] = useState(isAuthenticated())

  const handleLogout = () => {
    logout()
    setAuthed(false)
  }

  if (!authed) {
    return (
      <ToastProvider>
        <Login onLogin={() => setAuthed(true)} />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <Layout page={page} onNavigate={setPage} onLogout={handleLogout}>
        {page === "dashboard" && <Dashboard />}
        {page === "keys" && <Keys />}
        {page === "gitlab-login" && <GitLabLogin />}
        {page === "logs" && <Logs />}
        {page === "settings" && <Settings />}
      </Layout>
    </ToastProvider>
  )
}
