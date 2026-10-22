import { t } from '../../i18n'
import { isGenericSeasonName } from '../../library/lib'

// "Temporada 2", "Especiais", or the server's own name when it is a real one ("Dark Phoenix Saga")
export function seasonLabel(season) {
  if (season?.season === 0) return t('librarySeries.season.specials')
  if (!isGenericSeasonName(season?.name, season?.season)) return String(season.name)
  return t('librarySeries.season.n', { n: season?.season ?? '?' })
}

export default function SeasonSelector({ seasons = [], value, onChange }) {
  if (seasons.length === 0) return null
  return (
    <div role="group" aria-label={t('librarySeries.season.label')} className="flex flex-wrap gap-2">
      {seasons.map((season) => {
        const active = season.id === value
        return (
          <button
            key={season.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(season.id)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
              active
                ? 'border-purple-500 bg-purple-600/25 text-white'
                : 'border-gray-700 text-gray-400 hover:border-purple-400 hover:text-white'
            }`}
          >
            {seasonLabel(season)}
          </button>
        )
      })}
    </div>
  )
}
