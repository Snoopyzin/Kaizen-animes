import { useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'

// A titled, horizontally scrolling row ("Continuar assistindo"). Children are <li> items.
export default function Row({ title, children, className = '' }) {
  const scroller = useRef(null)
  const scroll = (direction) => {
    const el = scroller.current
    if (el && typeof el.scrollBy === 'function') {
      el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
    }
  }
  const arrow =
    'absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 group-hover/row:opacity-100 lg:flex'

  return (
    <section aria-label={title} className={`group/row relative ${className}`}>
      <h2 className="mb-3 border-b border-gray-700 pb-1 text-lg font-bold tracking-wider">
        {title}
      </h2>
      <div className="relative">
        <button
          type="button"
          aria-label={t('library.row.scrollLeft')}
          onClick={() => scroll(-1)}
          className={`${arrow} left-1`}
        >
          <ChevronLeftIcon width={20} height={20} />
        </button>
        <ul
          ref={scroller}
          className="flex snap-x gap-x-4 overflow-x-auto scroll-smooth pb-3 pt-1 [scrollbar-width:thin]"
        >
          {children}
        </ul>
        <button
          type="button"
          aria-label={t('library.row.scrollRight')}
          onClick={() => scroll(1)}
          className={`${arrow} right-1`}
        >
          <ChevronRightIcon width={20} height={20} />
        </button>
      </div>
    </section>
  )
}
