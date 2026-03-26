export default function StatsCard({ title, value, icon, subtitle }: {
  title: string
  value: string | number
  icon?: string
  subtitle?: string
}) {
  return (
    <div className="bg-white rounded-kawaii-lg p-6 shadow-kawaii-md transition-all duration-300 hover:-translate-y-2 hover:shadow-kawaii-lg cursor-default">
      {icon && <div className="text-3xl mb-2 animate-kawaii-float">{icon}</div>}
      <div className="text-sm text-kawaii-text-md mb-1">{title}</div>
      <div className="text-2xl font-bold kawaii-gradient-text">{value}</div>
      {subtitle && <div className="text-xs text-kawaii-text-lt mt-1">{subtitle}</div>}
    </div>
  )
}
