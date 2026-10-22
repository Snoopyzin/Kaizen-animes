// Backend / IPC error codes -> text for the user. The backend only sends codes; every sentence lives
// in the i18n files. Written as a switch (no key built by concatenation) so check:i18n sees every key.
import { t } from '../i18n'

export function errorCode(error) {
  return typeof error === 'string' ? error : error?.code || 'UNKNOWN'
}

export function errorMessage(error) {
  switch (errorCode(error)) {
    // connecting (IPC)
    case 'BAD_URL':
      return t('library.errors.BAD_URL')
    case 'UNREACHABLE':
      return t('library.errors.UNREACHABLE')
    case 'TIMEOUT':
      return t('library.errors.TIMEOUT')
    case 'TLS_ERROR':
      return t('library.errors.TLS_ERROR')
    case 'NOT_JELLYFIN':
      return t('library.errors.NOT_JELLYFIN')
    case 'BAD_CREDENTIALS':
      return t('library.errors.BAD_CREDENTIALS')
    case 'SERVER_ERROR':
      return t('library.errors.SERVER_ERROR')
    case 'UNAVAILABLE':
      return t('library.errors.UNAVAILABLE')
    // library requests (HTTP)
    case 'NOT_CONNECTED':
      return t('library.errors.NOT_CONNECTED')
    case 'AUTH_EXPIRED':
      return t('library.errors.AUTH_EXPIRED')
    case 'SERVER_UNREACHABLE':
      return t('library.errors.SERVER_UNREACHABLE')
    case 'UPSTREAM_ERROR':
      return t('library.errors.UPSTREAM_ERROR')
    case 'NOT_FOUND':
      return t('library.errors.NOT_FOUND')
    case 'BAD_REQUEST':
      return t('library.errors.BAD_REQUEST')
    case 'UNAUTHORIZED':
      return t('library.errors.UNAUTHORIZED')
    case 'BACKEND_DOWN':
      return t('library.errors.BACKEND_DOWN')
    case 'BAD_RESPONSE':
      return t('library.errors.BAD_RESPONSE')
    case 'INTERNAL':
      return t('library.errors.INTERNAL')
    default:
      return t('library.errors.UNKNOWN')
  }
}
