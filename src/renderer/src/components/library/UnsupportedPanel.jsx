import { Link } from 'react-router-dom'
import {
  ArrowLeftIcon,
  DesktopIcon,
  ExclamationTriangleIcon,
  ReloadIcon
} from '@radix-ui/react-icons'
import { t } from '../../i18n'
import { normalizeReason } from '../../library/lib'

// Why the built-in player can't play a file (reason = playback.reason of the backend, or one of
// ours for a runtime <video> error). Static switch: check:i18n sees every key.
export function reasonText(reason, { container = '', codec = '' } = {}) {
  switch (normalizeReason(reason)) {
    case 'container':
      return t('libraryPlayer.reason.container', { container: container || '?' })
    case 'video-codec':
      return t('libraryPlayer.reason.videoCodec', { codec: codec || '?' })
    case 'bit-depth':
      return t('libraryPlayer.reason.bitDepth')
    case 'no-video':
      return t('libraryPlayer.reason.noVideo')
    case 'playback-error':
      return t('libraryPlayer.reason.playbackError')
    case 'network-error':
      return t('libraryPlayer.reason.networkError')
    default:
      return t('libraryPlayer.reason.unknown')
  }
}

// Shown instead of the player (never a broken player): says why, and offers the external player
// (VLC / MPV from Settings), which plays almost anything.
export default function UnsupportedPanel({
  reason,
  container = '',
  codec = '',
  playerPath = '',
  onExternal,
  onRetry,
  backTo = '/library'
}) {
  const retryable = reason === 'network-error' || reason === 'playback-error'
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-y-4 rounded-md border border-gray-700 bg-[#18181b] px-6 py-10 text-center"
    >
      <ExclamationTriangleIcon
        width={32}
        height={32}
        className="text-amber-400"
        aria-hidden="true"
      />
      <h2 className="text-lg font-bold">
        {reason === 'network-error'
          ? t('libraryPlayer.unsupported.networkTitle')
          : t('libraryPlayer.unsupported.title')}
      </h2>
      <p className="max-w-xl text-sm leading-relaxed text-gray-300">
        {reasonText(reason, { container, codec })}
      </p>
      <p className="max-w-xl text-xs leading-relaxed text-gray-500">
        {t('libraryPlayer.unsupported.hint')}
      </p>

      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onExternal}
          className="flex items-center gap-x-2 rounded-md bg-purple-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
        >
          <DesktopIcon aria-hidden="true" />
          {t('libraryPlayer.openExternal')}
        </button>
        {retryable && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-x-2 rounded-md border border-gray-700 px-5 py-2.5 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            <ReloadIcon aria-hidden="true" />
            {t('libraryPlayer.retry')}
          </button>
        )}
        <Link
          to={backTo}
          className="flex items-center gap-x-2 rounded-md border border-gray-700 px-5 py-2.5 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <ArrowLeftIcon aria-hidden="true" />
          {t('libraryPlayer.back')}
        </Link>
      </div>
      {playerPath && (
        <p className="text-xs text-gray-600">
          {t('libraryPlayer.externalPath', { path: playerPath })}
        </p>
      )}
    </div>
  )
}
