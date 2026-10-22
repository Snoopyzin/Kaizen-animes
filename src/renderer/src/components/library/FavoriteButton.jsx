import { HeartFilledIcon, HeartIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'

// "Minha lista" toggle (the equivalent of the anime "Quero ver" list).
//  variant="icon"    round heart over a poster (the parent positions it)
//  variant="labeled" button with text, for the series / movie pages
export default function FavoriteButton({
  favorite = false,
  onToggle,
  title = '',
  variant = 'icon',
  className = ''
}) {
  const on = favorite === true
  if (variant === 'labeled') {
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className={`flex items-center gap-x-2 rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
          on
            ? 'border-purple-500/70 bg-purple-500/15 text-purple-200 hover:bg-purple-500/25'
            : 'border-gray-700 text-gray-300 hover:border-purple-400 hover:text-white'
        } ${className}`}
      >
        {on ? <HeartFilledIcon /> : <HeartIcon />}
        {on ? t('library.fav.inList') : t('library.fav.addShort')}
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('library.fav.remove', { title }) : t('library.fav.add', { title })}
      title={on ? t('library.fav.inList') : t('library.fav.addShort')}
      onClick={onToggle}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-all hover:bg-black/85 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
        on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      } ${className}`}
    >
      {on ? <HeartFilledIcon className="text-purple-400" /> : <HeartIcon />}
    </button>
  )
}
