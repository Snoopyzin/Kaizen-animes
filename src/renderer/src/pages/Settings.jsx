import { Button, Checkbox, Flex, Switch, TextField } from '@radix-ui/themes'
import { useKaizenContext } from '../utils/ContextProvider'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { t } from '../i18n'
import { BRAND } from '../brand'
import AccountCard from '../auth/AccountCard'
import UpdatesCard from '../components/UpdatesCard'
import { AUTH_ENABLED } from '../auth/config'
import LanguageSwitcher from '../i18n/LanguageSwitcher'

export default function Settings() {
  const {
    glow,
    setGlow,
    vlcPath,
    setVlcPath,
    autoUpdateAnilistEpisode,
    setAutoUpdateAnilistEpisode,
    scrollOpacity,
    setScrollOpacity,
    hideHero,
    setHideHero,
    backendPort,
    setBackendPort,
    broadcastDiscordRpc,
    setBroadcastDiscordRpc,
    hoverCard,
    setHoverCard,
    settings,
    setSettings,
    smoothScroll,
    setSmoothScroll,
    uploadLimit,
    setUploadLimit,
    downloadLimit,
    setDownloadLimit
  } = useKaizenContext()

  // const [settingsJson, setSettingsJson] = useState({})

  const [tempBackendPort, setTempBackendPort] = useState(backendPort)
  const [tempUploadLimit, setTempUploadLimit] = useState(uploadLimit === -1 ? '' : uploadLimit)
  const [tempDownloadLimit, setTempDownloadLimit] = useState(
    downloadLimit === -1 ? '' : downloadLimit
  )

  console.log('downloadLimit', downloadLimit);

  function toggleGlow() {
    const newGlowState = !glow // Determine the new state
    setGlow(newGlowState) // Update context state
    localStorage.setItem('glow', newGlowState ? 'true' : 'false') // Update localStorage correctly
  }

  function updateVlcPath(e) {
    // replace double quotes with empty string
    const newPath = e.target.value.replace(/"/g, '')
    setVlcPath(`"${newPath}"`)
    localStorage.setItem('vlcPath', `"${newPath}"`)
  }
  function updateUploadLimit(e) {
    let newSpeed = -1
    let value = parseInt(e.target.value, 10) // Convert input to number
    setTempUploadLimit(value)
    if (!isNaN(value) && value > -1) {
      newSpeed = value
      window.api.saveToSettings('uploadLimit', newSpeed * 1024)
    } else {
      window.api.saveToSettings('uploadLimit', newSpeed)
    }
    setUploadLimit(newSpeed)
  }
  function updateDownloadLimit(e) {
    let newSpeed = -1
    let value = parseInt(e.target.value, 10) // Convert input to number
    setTempDownloadLimit(value)
    if (!isNaN(value) && value > -1) {
      newSpeed = value
      window.api.saveToSettings('downloadLimit', newSpeed * 1024)
    } else {
      window.api.saveToSettings('downloadLimit', newSpeed)
    }
    setDownloadLimit(newSpeed)
  }

  function toggleAutoUpdateAnilistEpisode() {
    const newAutoUpdateAnilistEpisodeState = !autoUpdateAnilistEpisode
    setAutoUpdateAnilistEpisode(newAutoUpdateAnilistEpisodeState)
    localStorage.setItem(
      'autoUpdateAnilistEpisode',
      newAutoUpdateAnilistEpisodeState ? 'true' : 'false'
    )
  }

  function toggleScrollOpacity() {
    const newScrollOpacityState = !scrollOpacity
    setScrollOpacity(newScrollOpacityState)
    localStorage.setItem('scrollOpacity', newScrollOpacityState ? 'true' : 'false')
  }

  function toggleHideHero() {
    const newHideHeroState = !hideHero
    setHideHero(newHideHeroState)
    localStorage.setItem('hideHero', newHideHeroState ? 'true' : 'false')
    if (newHideHeroState === true) {
      localStorage.setItem('scrollOpacity', 'false')
      setScrollOpacity(false)
    }
  }

  // async function getSettingsJson() {
  //   let data = await window.api.getSettingsJson()
  //   setSettingsJson(data)
  // }

  async function changeDownloadsFolder() {
    let data = await window.api.changeDownloadsFolder()
    // setSettingsJson(data)
    setSettings(data)
  }

  function toggleHoverCard() {
    const newHoverCardState = !hoverCard
    setHoverCard(newHoverCardState)
    localStorage.setItem('hoverCard', newHoverCardState ? 'true' : 'false')
  }

  function toggleSmoothScroll() {
    const newSmoothScrollState = !smoothScroll
    setSmoothScroll(newSmoothScrollState)
    localStorage.setItem('smoothScroll', newSmoothScrollState ? 'true' : 'false')
  }

  // useEffect(() => {
  //   getSettingsJson()
  // }, [])

  console.log(settings)

  return (
    <div className="w-full animate-fade select-none px-16 py-10 font-space-mono animate-duration-500">
      <div className="mb-8 border-b border-gray-700 pb-2 font-semibold tracking-wider text-[#b5b5b5ff]">
        {t('settings.title')}
      </div>

      <div className="mb-6">
        {AUTH_ENABLED ? (
          <AccountCard />
        ) : (
          <div className="flex max-w-xl items-center justify-between gap-x-4 rounded-md border border-gray-700 p-4 font-space-mono text-sm">
            <span className="text-gray-500">{t('auth.account.language')}</span>
            <LanguageSwitcher />
          </div>
        )}
      </div>

      <div className="mb-6">
        <UpdatesCard />
      </div>

      <div className="flex flex-col gap-4 tracking-wide text-[#b5b5b5ff]">
        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">{t('settings.glow.title')}</p>
            <p className="text-xs">{t('settings.glow.desc')}</p>
          </div>
          <Switch
            checked={glow}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={toggleGlow}
          />
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">{t('settings.autoUpdate.title')}</p>
            <p className="text-xs">{t('settings.autoUpdate.desc', { app: BRAND.name })}</p>
          </div>
          <Switch
            checked={autoUpdateAnilistEpisode}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={toggleAutoUpdateAnilistEpisode}
          />
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">{t('settings.scrollOpacity.title')}</p>
            <p className="text-xs">
              {t('settings.scrollOpacity.descPre')}<b>{t('settings.scrollOpacity.bold1')}</b>{' '}
              <b>{t('settings.scrollOpacity.bold2')}</b>.
            </p>
          </div>
          <Switch
            checked={scrollOpacity}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={toggleScrollOpacity}
          />
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">{t('settings.hideHero.title')}</p>
            <p className="text-xs">{t('settings.hideHero.desc')}</p>
          </div>
          <Switch
            checked={hideHero}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={toggleHideHero}
          />
        </div>
        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">{t('settings.hoverCard.title')}</p>
            <p className="text-xs">
              {t('settings.hoverCard.desc1')} <br /> {t('settings.hoverCard.desc2')}
              <b>{t('settings.hoverCard.bold')}</b>
              {t('settings.hoverCard.desc3')}
            </p>
          </div>
          <Switch
            checked={hoverCard}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={toggleHoverCard}
          />
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="text_input_card">
            <p className="font-bold">{t('settings.player.title')}</p>
            <p className="text-xs">{t('settings.player.desc')}</p>
            <p className="text-xs">{t('settings.currentPath', { path: vlcPath })}</p>
          </div>
          <TextField.Root
            placeholder={vlcPath}
            value={vlcPath.replace(/"/g, '')}
            onInput={updateVlcPath}
            className="w-1/2"
          ></TextField.Root>
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="text_input_card">
            <p className="font-bold">{t('settings.downloadLimit.title')}</p>
            <p className="text-xs">
              {t('settings.downloadLimit.desc')} <br /> {t('settings.limitEmpty')}{' '}
              <b>{t('settings.limitRestartBold')}</b>
              {t('settings.limitRestartPost')}
            </p>
            <p className="text-xs">
              {t('settings.currentSpeed', {
                speed: downloadLimit === -1 ? t('settings.unlimited') : downloadLimit + ' KB/s'
              })}
            </p>
          </div>
          <TextField.Root
            type="number"
            placeholder={t('settings.unlimited')}
            onInput={updateDownloadLimit}
            value={tempDownloadLimit}
            className="w-1/2"
          ></TextField.Root>
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="text_input_card">
            <p className="font-bold">{t('settings.uploadLimit.title')}</p>
            <p className="text-xs">
              {t('settings.uploadLimit.desc')} <br /> {t('settings.limitEmpty')}{' '}
              <b>{t('settings.limitRestartBold')}</b>
              {t('settings.limitRestartPost')}
            </p>
            <p className="text-xs">
              {t('settings.currentSpeed', {
                speed: uploadLimit === -1 ? t('settings.unlimited') : uploadLimit + ' KB/s'
              })}
            </p>
          </div>
          <TextField.Root
            type="number"
            placeholder={t('settings.unlimited')}
            onInput={updateUploadLimit}
            value={tempUploadLimit}
            className="w-1/2"
          ></TextField.Root>
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="button_card">
            <p className="font-bold">{t('settings.folder.title')}</p>
            <p className="text-xs">{t('settings.folder.desc')}</p>
            <p className="text-xs">
              {t('settings.currentPathQuoted', { path: settings.downloadsFolderPath })}
            </p>
          </div>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => {
              changeDownloadsFolder()
            }}
          >
            {t('settings.folder.button')}
          </Button>
        </div>
        {/* Form with input */}

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="">
            <p className="font-bold">{t('settings.port.title')}</p>
            <p className="text-xs">
              {t('settings.port.descA')} <b className="tracking-wider">{t('settings.port.reopenBold')}</b>
              {t('settings.port.descB')}
              <br />
              {t('settings.port.descC')}
            </p>
            <p className="text-xs">
              {t('settings.port.current')} <b className="tracking-wider">{backendPort}</b>
            </p>
          </div>

          <div className="flex w-fit">
            <TextField.Root
              placeholder={backendPort}
              type="number"
              value={tempBackendPort}
              onInput={(e) => setTempBackendPort(e.target.value)}
              className="w-24"
              style={{
                borderRadius: '0.25rem 0 0 0.25rem'
              }}
            ></TextField.Root>

            <Button
              variant="outline"
              color="gray"
              onClick={() => {
                setBackendPort(tempBackendPort)
                window.api.changeBackendPort(tempBackendPort)
                toast.success(t('settings.port.changed', { port: tempBackendPort }))
                // window.api.changeBackendPort(64622)
              }}
              style={{
                borderRadius: '0 0.25rem 0.25rem 0',
                // boxShadow: '0 0 1px 0px #4863bd'
                boxShadow: 'none',
                border: '1px solid #4e5359',
                borderLeft: '0px'
              }}
            >
              {t('settings.port.save')}
            </Button>
          </div>
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">Discord RPC</p>
            <p className="text-xs">{t('settings.discord.desc', { app: BRAND.name })}</p>
          </div>
          <Switch
            checked={broadcastDiscordRpc}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={() => {
              setBroadcastDiscordRpc(!broadcastDiscordRpc)
              window.api.broadcastDiscordRpc(!broadcastDiscordRpc)
            }}
          />
        </div>

        <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
          <div className="switch_card">
            <p className="font-bold">{t('settings.smoothScroll.title')}</p>
            <p className="text-xs">
              {t('settings.smoothScroll.desc1')} <br /> {t('settings.smoothScroll.desc2')}
            </p>
          </div>
          <Switch
            checked={smoothScroll}
            style={{ marginLeft: '1.5rem', cursor: 'pointer' }}
            onCheckedChange={() => {
              toggleSmoothScroll()
            }}
          />
        </div>
      </div>

      <div className="keyboard_shortcuts mt-8">
        <div className="mb-8 border-b border-gray-700 pb-2 font-semibold tracking-wider text-[#b5b5b5ff]">
          {t('settings.shortcuts.title')}
        </div>
        <div className="flex flex-col gap-4 tracking-wide text-[#b5b5b5ff]">
          <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
            <div className="switch_card">
              <p className="font-bold">{t('settings.shortcuts.navTitle')}</p>
              <p className="text-xs">{t('settings.shortcuts.navDesc')}</p>
            </div>
          </div>
          {/* <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
            <div className="switch_card">
              <p className="font-bold">Ctrl + R</p>
              <p className="text-xs">Refresh the page using Ctrl + R</p>
            </div>
          </div> */}
          <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
            <div className="switch_card">
              <p className="font-bold">Ctrl + K</p>
              <p className="text-xs">{t('settings.shortcuts.searchDesc')}</p>
            </div>
          </div>
          <div className="flex w-full items-center justify-between bg-[#202022] px-4 py-2">
            <div className="switch_card">
              <p className="font-bold">{t('settings.shortcuts.seekTitle')}</p>
              <p className="text-xs">{t('settings.shortcuts.seekDesc')}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs opacity-45">
        {t('settings.disclaimer')}
      </p>
    </div>
  )
}
