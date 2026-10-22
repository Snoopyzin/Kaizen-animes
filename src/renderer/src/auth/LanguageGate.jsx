import AuthShell from './AuthShell'
import { getLastLanguage, setLanguage } from '../i18n'

// Shown once, before anything else. Deliberately bilingual: no language has been chosen yet.
export default function LanguageGate() {
  const last = getLastLanguage()
  const btn = (code) =>
    `rounded-md border px-4 py-3 text-left font-space-mono transition-all hover:border-purple-400 hover:bg-purple-500/10 ${
      last === code ? 'border-purple-500/70' : 'border-gray-700'
    }`
  return (
    <AuthShell>
      <div className="w-full rounded-lg border border-gray-700 bg-black/60 p-6 backdrop-blur">
        <p className="mb-1 text-center font-space-mono text-lg font-bold">Escolha seu idioma</p>
        <p className="mb-5 text-center font-space-mono text-sm text-gray-400">Choose your language</p>
        <div className="flex flex-col gap-y-3">
          <button
            onClick={() => setLanguage('pt')}
            className={btn('pt')}
          >
            Português <span className="text-gray-500">(Brasil)</span>
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={btn('en')}
          >
            English
          </button>
        </div>
        <p className="mt-4 text-center font-space-mono text-xs text-gray-500">
          Perguntamos a cada abertura do app · We ask every time the app opens
        </p>
      </div>
    </AuthShell>
  )
}
