import { Link, useNavigate } from 'react-router-dom'
import { ExclamationTriangleIcon, ReloadIcon } from '@radix-ui/react-icons'
import { Spinner } from '@radix-ui/themes'
import { t } from '../../i18n'
import { errorCode, errorMessage } from '../../library/errors'
import { useLibraryStatus, useResetLibrary } from '../../library/hooks'
import { errorKind } from '../../library/lib'
import ConnectCard from './ConnectCard'
import EmptyState from './EmptyState'

const primary =
  'flex items-center gap-x-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:opacity-60'
const secondary =
  'rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400'

function RetryButton({ onRetry, retrying }) {
  if (!onRetry) return null
  return (
    <button type="button" onClick={onRetry} disabled={retrying} className={primary}>
      {retrying ? <Spinner size="1" /> : <ReloadIcon aria-hidden="true" />}
      {t('library.error.retry')}
    </button>
  )
}

// The session expired (AUTH_EXPIRED) or no server is configured (NOT_CONNECTED): the connect form,
// with the server fixed and the user prefilled in the first case.
function ConnectPanel({ expired, onConnected }) {
  const status = useLibraryStatus()
  const reset = useResetLibrary()
  const server = status.data?.connected ? status.data.server : null
  return (
    <div className="flex flex-col items-center gap-y-4 px-4 pb-24 pt-24 font-space-mono">
      <ConnectCard
        mode={expired && server ? 'reconnect' : 'connect'}
        server={server}
        onConnected={(next) => {
          reset.afterConnect({ connected: true, server: next })
          onConnected?.(next)
        }}
      />
    </div>
  )
}

// Every way a library request can fail, as a screen (or, with `compact`, as a banner above content
// that is still on screen).
export default function ErrorState({
  error,
  onRetry,
  retrying = false,
  onChangeServer,
  onConnected,
  compact = false,
  backLink = true,
  className
}) {
  const navigate = useNavigate()
  const code = errorCode(error)
  const kind = errorKind(code)

  if (kind === 'auth' || kind === 'not-connected') {
    return <ConnectPanel expired={kind === 'auth'} onConnected={onConnected} />
  }

  const spacing = className ?? 'px-8 pb-24 pt-24'
  const changeServer =
    onChangeServer || (() => navigate('/library', { state: { changeServer: true } }))

  if (compact) {
    return (
      <div
        role="alert"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-800 bg-amber-950/40 px-4 py-3 font-space-mono text-sm text-amber-100"
      >
        <span className="flex items-center gap-x-2">
          <ExclamationTriangleIcon aria-hidden="true" />
          {errorMessage(code)}
        </span>
        <span className="flex gap-x-2">
          <RetryButton onRetry={onRetry} retrying={retrying} />
          {kind === 'unreachable' && (
            <button type="button" onClick={changeServer} className={secondary}>
              {t('library.error.changeServer')}
            </button>
          )}
        </span>
      </div>
    )
  }

  if (kind === 'unreachable') {
    return (
      <div className={spacing}>
        <EmptyState
          icon={<ExclamationTriangleIcon width={32} height={32} />}
          title={t('library.errors.SERVER_UNREACHABLE')}
          text={t('library.error.unreachableBody')}
        >
          <RetryButton onRetry={onRetry} retrying={retrying} />
          <button type="button" onClick={changeServer} className={secondary}>
            {t('library.error.changeServer')}
          </button>
        </EmptyState>
      </div>
    )
  }

  if (kind === 'not-found') {
    return (
      <div className={spacing}>
        <EmptyState
          icon={<ExclamationTriangleIcon width={32} height={32} />}
          title={t('library.errors.NOT_FOUND')}
          text={t('library.error.notFoundBody')}
        >
          <Link to="/library" className={primary}>
            {t('library.error.backToLibrary')}
          </Link>
        </EmptyState>
      </div>
    )
  }

  // local service problems and everything else
  return (
    <div className={spacing}>
      <EmptyState
        icon={<ExclamationTriangleIcon width={32} height={32} />}
        title={t('library.error.title')}
        text={errorMessage(code)}
      >
        <RetryButton onRetry={onRetry} retrying={retrying} />
        {backLink && (
          <Link to="/library" className={secondary}>
            {t('library.error.backToLibrary')}
          </Link>
        )}
      </EmptyState>
    </div>
  )
}
