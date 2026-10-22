import { useId } from 'react'
import { Cross2Icon, MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'
import { FILTERS, SORTS } from '../../library/lib'

// Static switches (no key built by concatenation) so check:i18n sees every key
const filterLabel = (name) => {
  switch (name) {
    case 'movies':
      return t('library.filter.movies')
    case 'series':
      return t('library.filter.series')
    case 'favorites':
      return t('library.filter.favorites')
    default:
      return t('library.filter.all')
  }
}
const sortLabel = (name) => {
  switch (name) {
    case 'title':
      return t('library.sort.title')
    case 'year':
      return t('library.sort.year')
    case 'rating':
      return t('library.sort.rating')
    default:
      return t('library.sort.added')
  }
}

// Chips (Todos / Filmes / Séries / Minha lista), search and sort of the library page.
export default function FilterBar({
  filter,
  onFilter,
  query,
  onQuery,
  sort,
  onSort,
  counts = { all: 0, movies: 0, series: 0, favorites: 0 }
}) {
  const searchId = useId()
  const sortId = useId()

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div role="group" aria-label={t('library.filter.label')} className="flex flex-wrap gap-2">
        {FILTERS.map((name) => {
          const active = filter === name
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(name)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                active
                  ? 'border-purple-500 bg-purple-600/25 text-white'
                  : 'border-gray-700 text-gray-400 hover:border-purple-400 hover:text-white'
              }`}
            >
              {filterLabel(name)}
              <span className="ml-1.5 text-xs opacity-60">{counts[name] ?? 0}</span>
            </button>
          )
        })}
      </div>

      <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
        <label htmlFor={searchId} className="sr-only">
          {t('library.search.label')}
        </label>
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('library.search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-gray-700 bg-[#18181b] py-2 pl-9 pr-9 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label={t('library.search.clear')}
            onClick={() => onQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            <Cross2Icon aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-x-2 text-sm">
        <label htmlFor={sortId} className="text-gray-500">
          {t('library.sort.label')}
        </label>
        <select
          id={sortId}
          value={sort}
          onChange={(e) => onSort(e.target.value)}
          className="rounded-md border border-gray-700 bg-[#18181b] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-purple-400"
        >
          {SORTS.map((name) => (
            <option key={name} value={name}>
              {sortLabel(name)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
