import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import { NEXT_EPISODE_SECONDS } from '../../library/lib'

// "Próximo episódio em 10 s - Assistir agora / Cancelar". Drawn inside the Plyr container (a portal),
// otherwise it would be hidden behind the video when the player is fullscreen.
export default function NextEpisodeOverlay({ container, next, seconds, onPlay, onCancel }) {
  const playButton = useRef(null)
  useEffect(() => {
    playButton.current?.focus({ preventScroll: true }) // Enter = watch now
  }, [])

  if (!container || !next) return null
  const name = [next.label, next.title].filter(Boolean).join(' - ')

  return createPortal(
    <div
      role="dialog"
      aria-label={t('libraryPlayer.next.label')}
      className="absolute bottom-20 right-4 z-30 w-80 max-w-[calc(100%-2rem)] overflow-hidden rounded-md border border-gray-600 bg-black/90 font-space-mono text-white"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">
          {t('libraryPlayer.next.in', { seconds: Math.max(0, seconds) })}
        </p>
        {name && (
          <p title={name} className="mt-1 line-clamp-2 text-sm font-medium">
            {name}
          </p>
        )}
        <div className="mt-3 flex gap-x-2">
          <button
            ref={playButton}
            type="button"
            onClick={onPlay}
            className="flex-1 rounded-md bg-purple-600 px-3 py-2 text-sm font-bold transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          >
            {t('libraryPlayer.next.now')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-600 px-3 py-2 text-sm text-gray-200 transition-colors hover:border-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            {t('libraryPlayer.next.cancel')}
          </button>
        </div>
      </div>
      <div className="h-1 bg-gray-700" aria-hidden="true">
        <div
          className="h-full bg-purple-500 transition-all duration-1000 ease-linear"
          style={{
            width: `${Math.max(0, Math.min(100, (seconds / NEXT_EPISODE_SECONDS) * 100))}%`
          }}
        />
      </div>
    </div>,
    container
  )
}
