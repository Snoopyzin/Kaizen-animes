// Centered message with an optional icon and action ("nothing here yet", "no results"...).
export default function EmptyState({
  icon = null,
  title,
  text = '',
  children = null,
  className = ''
}) {
  return (
    <div
      className={`mx-auto flex max-w-xl flex-col items-center gap-y-3 px-4 py-16 text-center font-space-mono ${className}`}
    >
      {icon && <div className="text-gray-500">{icon}</div>}
      <p className="text-base font-medium opacity-90">{title}</p>
      {text && <p className="text-sm text-gray-400">{text}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  )
}
