import { LinkBreak2Icon, ReloadIcon } from '@radix-ui/react-icons'
import { AlertDialog, Button, Flex, Spinner } from '@radix-ui/themes'
import { t } from '../../i18n'
import { formatClockTime } from '../../library/lib'
import { uiLocale } from '../../library/locale'

// "Casa · 192.168.0.10:8096 · gabriel" with Atualizar and Desconectar (asks first).
export default function ServerChip({
  server,
  fetchedAt = 0,
  refreshing = false,
  disconnecting = false,
  onRefresh,
  onDisconnect
}) {
  const name = server?.name || server?.host || ''
  const parts = [server?.name, server?.host, server?.userName].filter(Boolean)
  const updated = formatClockTime(fetchedAt, uiLocale())

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs">
      <div
        className="flex min-w-0 items-center gap-x-2 rounded-full border border-gray-700 bg-[#18181b] px-3 py-1.5"
        title={
          server?.version ? t('library.server.version', { version: server.version }) : undefined
        }
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
        <span className="sr-only">{t('library.server.connected')}</span>
        <span className="truncate text-gray-200">{parts.join(' · ')}</span>
      </div>
      {updated && (
        <span className="hidden text-gray-500 lg:inline">
          {t('library.server.updatedAt', { time: updated })}
        </span>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-x-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-60"
      >
        {refreshing ? <Spinner size="1" /> : <ReloadIcon aria-hidden="true" />}
        {refreshing ? t('library.server.refreshing') : t('library.server.refresh')}
      </button>

      <AlertDialog.Root>
        <AlertDialog.Trigger>
          <button
            type="button"
            disabled={disconnecting}
            className="flex items-center gap-x-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-gray-300 transition-colors hover:border-red-500 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-60"
          >
            <LinkBreak2Icon aria-hidden="true" />
            {t('library.server.disconnect')}
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            {t('library.server.disconnectTitle', { server: name })}
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
            {t('library.server.disconnectBody')}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                {t('library.server.cancel')}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={onDisconnect}>
                {t('library.server.disconnectConfirm')}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  )
}
