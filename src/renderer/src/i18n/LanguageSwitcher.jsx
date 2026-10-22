import { LANGUAGES, getLanguage, setLanguage } from './index'

// Two-button language picker; choosing reloads the interface in the new language.
export default function LanguageSwitcher({ className = '' }) {
  const current = getLanguage()
  return (
    <div className={`inline-flex overflow-hidden rounded-md border border-gray-700 ${className}`}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => l.code !== current && setLanguage(l.code)}
          className={`px-3 py-1.5 font-space-mono text-xs transition-colors ${
            l.code === current ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-white/10'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
