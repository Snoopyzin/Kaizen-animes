// react-query hooks of the library. Queries are keyed under ['library', ...]; mutations patch the
// cache first (instant feedback) and roll back when the server refuses.
import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { t } from '../i18n'
import { useKaizenContext } from '../utils/ContextProvider'
import {
  fetchIndex,
  fetchSeries,
  fetchStatus,
  fetchVideo,
  libraryUrls,
  sendFavorite,
  sendWatched
} from './api.js'
import { errorMessage } from './errors'
import {
  normalizePort,
  patchIndexFavorite,
  patchSeriesFavorite,
  patchSeriesWatched,
  patchVideoFavorite,
  patchVideoWatched
} from './lib.js'

export const KEYS = {
  all: ['library'],
  status: ['library', 'status'],
  index: ['library', 'index'],
  series: (id) => ['library', 'series', id],
  video: (id) => ['library', 'video', id]
}

const STALE_MS = 30 * 1000
const RETRYABLE = ['BACKEND_DOWN', 'INTERNAL', 'UPSTREAM_ERROR', 'BAD_RESPONSE']

// one quick retry for hiccups of the local backend; everything else is shown at once (the screens
// have their own "try again")
const retry = (failureCount, error) => failureCount < 1 && RETRYABLE.includes(error?.code)

export function useLibraryPort() {
  const { backendPort } = useKaizenContext()
  return normalizePort(backendPort)
}

// builders for <img src>, <video src>, TracksMenu... (they read the token when called)
export function useLibraryUrls() {
  const port = useLibraryPort()
  return useMemo(() => libraryUrls(port), [port])
}

/* ------------------------------ queries ------------------------------ */

export function useLibraryStatus() {
  const port = useLibraryPort()
  return useQuery({
    queryKey: KEYS.status,
    queryFn: () => fetchStatus(port),
    staleTime: STALE_MS,
    retry,
    retryDelay: 800
  })
}

export function useLibraryIndex({ enabled = true } = {}) {
  const port = useLibraryPort()
  return useQuery({
    queryKey: KEYS.index,
    queryFn: () => fetchIndex(port),
    enabled,
    staleTime: STALE_MS,
    retry,
    retryDelay: 800
  })
}

export function useSeries(id) {
  const port = useLibraryPort()
  return useQuery({
    queryKey: KEYS.series(id),
    queryFn: () => fetchSeries(port, id),
    enabled: !!id,
    staleTime: STALE_MS,
    retry,
    retryDelay: 800
  })
}

// `fresh`: never reuse an older answer (the player resumes from video.progress)
export function useVideo(id, { fresh = false } = {}) {
  const port = useLibraryPort()
  return useQuery({
    queryKey: KEYS.video(id),
    queryFn: () => fetchVideo(port, id),
    enabled: !!id,
    staleTime: fresh ? 0 : STALE_MS,
    // (an explicit `gcTime: undefined` would override the app-wide default, so the key is left out)
    ...(fresh ? { gcTime: 0, refetchOnMount: 'always' } : {}),
    retry,
    retryDelay: 800
  })
}

/* ------------------------------ cache helpers ------------------------------ */

// after a change on the server: pages on screen refetch, the others are only marked stale
export function useInvalidateLibrary() {
  const qc = useQueryClient()
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ['library', 'series'] })
    qc.invalidateQueries({ queryKey: ['library', 'video'] })
    qc.invalidateQueries({ queryKey: KEYS.index, refetchType: 'none' })
  }, [qc])
}

// A new session (first connection, reconnection, another server) or none at all: forget what came
// from the previous one. Pages on screen reload by themselves.
export function useResetLibrary() {
  const qc = useQueryClient()
  return useMemo(
    () => ({
      afterConnect(status) {
        if (status) qc.setQueryData(KEYS.status, status)
        qc.resetQueries({ queryKey: KEYS.index })
        qc.resetQueries({ queryKey: ['library', 'series'] })
        qc.resetQueries({ queryKey: ['library', 'video'] })
      },
      afterDisconnect() {
        qc.removeQueries({ queryKey: KEYS.index })
        qc.removeQueries({ queryKey: ['library', 'series'] })
        qc.removeQueries({ queryKey: ['library', 'video'] })
        qc.setQueryData(KEYS.status, { connected: false, server: null })
      }
    }),
    [qc]
  )
}

const snapshot = (qc) => qc.getQueriesData({ queryKey: KEYS.all })
const restore = (qc, snapshots) => {
  for (const [key, data] of snapshots || []) qc.setQueryData(key, data)
}

// a session that is gone: let the page that is showing data switch to the reconnect screen
function afterFailure(qc, error) {
  if (error?.code === 'AUTH_EXPIRED' || error?.code === 'NOT_CONNECTED') {
    qc.invalidateQueries({ queryKey: KEYS.index })
    return
  }
  toast.error(errorMessage(error))
}

/* ------------------------------ mutations ------------------------------ */

// Atualizar: GET /library?refresh=1 and put the answer in the cache
export function useRefreshIndex() {
  const port = useLibraryPort()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fetchIndex(port, { refresh: true }),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.index, data)
      toast.success(t('library.toast.refreshed'))
    },
    onError: (error) => afterFailure(qc, error)
  })
}

// variables: { id, favorite }
export function useToggleFavorite() {
  const port = useLibraryPort()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, favorite }) => sendFavorite(port, id, favorite),
    onMutate: async ({ id, favorite }) => {
      await qc.cancelQueries({ queryKey: KEYS.all })
      const snapshots = snapshot(qc)
      qc.setQueryData(KEYS.index, (old) => patchIndexFavorite(old, id, favorite))
      qc.setQueryData(KEYS.series(id), (old) => patchSeriesFavorite(old, favorite))
      qc.setQueryData(KEYS.video(id), (old) => patchVideoFavorite(old, favorite))
      return { snapshots }
    },
    onError: (error, variables, context) => {
      restore(qc, context?.snapshots)
      if (error?.code === 'AUTH_EXPIRED' || error?.code === 'NOT_CONNECTED') afterFailure(qc, error)
      else toast.error(t('library.toast.favoriteError'), { description: errorMessage(error) })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.index, refetchType: 'none' })
  })
}

// variables: { ids, watched, seriesId?, videoId? }  (the last two only say which cached pages to patch)
export function useSetWatched() {
  const port = useLibraryPort()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, watched }) => sendWatched(port, ids, watched),
    onMutate: async ({ ids, watched, seriesId, videoId }) => {
      await qc.cancelQueries({ queryKey: KEYS.all })
      const snapshots = snapshot(qc)
      if (seriesId) {
        qc.setQueryData(KEYS.series(seriesId), (old) => patchSeriesWatched(old, ids, watched))
      }
      if (videoId) qc.setQueryData(KEYS.video(videoId), (old) => patchVideoWatched(old, watched))
      return { snapshots }
    },
    onError: (error, variables, context) => {
      restore(qc, context?.snapshots)
      if (error?.code === 'AUTH_EXPIRED' || error?.code === 'NOT_CONNECTED') afterFailure(qc, error)
      else toast.error(t('library.toast.watchedError'), { description: errorMessage(error) })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['library', 'series'] })
      qc.invalidateQueries({ queryKey: ['library', 'video'] })
      qc.invalidateQueries({ queryKey: KEYS.index, refetchType: 'none' })
    }
  })
}
