import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

type ToastType = "success" | "error"
type Toast = { id: number; message: string; type: ToastType }
type ToastCtx = { toast: (message: string, type?: ToastType) => void }

const Ctx = createContext<ToastCtx>({ toast: () => {} })
export const useToast = () => useContext(Ctx)

let _id = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<number[]>([])

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++_id
    setToasts((t) => [...t, { id, message, type }])
    const timer = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      timersRef.current = timersRef.current.filter((v) => v !== timer)
    }, 3000)
    timersRef.current.push(timer)
  }, [])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t))
      timersRef.current = []
    }
  }, [])

  return (
    <Ctx value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-5 py-3 rounded-full text-sm font-medium shadow-kawaii-md ${
              t.type === "success"
                ? "bg-kawaii-green-light text-kawaii-text border-2 border-kawaii-green"
                : "bg-kawaii-pink-light text-kawaii-text border-2 border-kawaii-pink"
            }`}
          >
            {t.type === "success" ? "\u2705 " : "\u26A0\uFE0F "}{t.message}
          </div>
        ))}
      </div>
    </Ctx>
  )
}
