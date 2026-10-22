import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { parseAnimepaheImage } from '../utils/parseAnimepaheImage'
import { format } from 'date-fns'
import { t, dateLocale } from '../../../i18n'
import { Button, Code, Skeleton, Tooltip } from '@radix-ui/themes'
import useGetAnimePaheEps from '../hooks/useGetAnimePahePlayData'
import SlidingPane from 'react-sliding-pane'
import '../../../sliding-pane.css'
import AnimePahePlayerEmbedded from '../pages/AnimePahePlayerEmbedded'
import { useKaizenContext } from '../../../utils/ContextProvider'
import { OpenInNewWindowIcon } from '@radix-ui/react-icons'

export default function AnimePaheEpisode({ data }) {
  const {
    id,
    anime_id,
    idMal,
    anime_session,
    episode,
    episode2,
    snapshot,
    session,
    created_at,
    anime_hash,
    finalEpWatched,
    ix,
    anime_title,
    progress,
    hideWatchedEpisodes,
    discordRpcActivity
  } = data
  const sanitize = (str) => str.replace(/["]/g, '\\"') // Simple sanitization for double quotes

  const navigate = useNavigate()
  const [active, setActive] = useState(false)
  // const progress = data?.progress || 0

  // on pressing escape, close the dropdown
  const [paneState, setPaneState] = useState({
    isPaneOpen: false,
    isPaneOpenLeft: false
  })

  const {
    isLoading,
    data: episodePlayData,
    error
  } = useGetAnimePaheEps(anime_hash, active ? session : null)

  console.log('Episode Play Data: ')

  console.log(episodePlayData)

  function handleClick() {
    // e.stopPropagation()
    if (active) {
      setActive(false)
      return
    }
    setActive((prevActive) => !prevActive)
  }

  const { vlcPath } = useKaizenContext()

  // console.log(ix + ' ' + finalEpWatched)

  // disable scrolling when dropdown is open
  if (paneState.isPaneOpen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = 'auto'
  }

  const [videoSrc, setVideoSrc] = useState(null)

  useEffect(() => {
    if (discordRpcActivity && videoSrc) {
      window.api.setDiscordRpc({ ...discordRpcActivity, state: t('animePaheEpisode.discordWatching', { episode }) })
    }
    // return () => {
    // window.api.setDiscordRpc({ ...discordRpcActivity })
    // }
  }, [videoSrc])

  if (parseInt(episode) <= parseInt(progress) && hideWatchedEpisodes) return null
  const knownPlayers = ['mpv', 'vlc']

  return (
    <div className="flex w-full cursor-default flex-col border border-gray-700 font-space-mono transition-all duration-100 ease-in-out hover:bg-[#1e1e20] hover:opacity-100">
      <div className="flex">
        {snapshot && (
          <img
            loading="lazy"
            src={parseAnimepaheImage(snapshot)}
            alt="episode_img"
            className="duration-400 mr-3 h-28 animate-fade object-cover transition-all ease-in-out hover:z-20 hover:scale-150 hover:rounded-md"
          />
        )}

        <div
          onClick={() => handleClick()}
          className={`h-full w-full cursor-default p-2 font-space-mono transition-all duration-100 ease-in-out hover:bg-[#1e1e20] hover:opacity-100`}
        >
          <div className={`flex h-full items-center justify-between`}>
            <div className="flex items-center gap-x-1 font-space-mono font-medium opacity-90">
              {/* <p className="text-lg">{episodeNumber}. </p> */}
              <div>
                <p className="flex items-center gap-2 font-space-mono text-lg font-medium opacity-100">
                  {/* {ix + 1 <= finalEpWatched && (
                    <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  )} */}
                  {parseInt(episode) <= parseInt(progress) && (
                    <Tooltip content={t('animePaheEpisode.watched')}>
                      <p className="h-2 min-h-2 w-2 min-w-2 rounded-full bg-green-500"></p>
                    </Tooltip>
                  )}
                  <p className="line-clamp-1">
                    {' '}
                    <span className="">{ix + 1}.</span> {t('animePaheEpisode.episode', { episode })}
                  </p>
                </p>
              </div>
            </div>
            <div className="flex w-fit gap-x-2 text-xs">
              {/* <p className="">{data.filler ? "Filler" : "Not Filler"}</p> */}
              {/* <p>{data.recap ? "Recap" : "Not Recap"}</p> */}
              <div className="ml-4 h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              {/* {isRecent && <div className="h-5 w-[1px] bg-[#333]"></div>} Divider */}
              {created_at && (
                <p className={`text-nowrap opacity-90`}>
                  {format(new Date(created_at), 'dd MMM yyyy', { locale: dateLocale() })}
                </p>
              )}
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              {/* <p className="opacity-60">{data.score}</p> */}
            </div>
          </div>
        </div>
      </div>
      <SlidingPane
        isOpen={paneState.isPaneOpen}
        shouldCloseOnEsc
        title={t('animePaheEpisode.episode', { episode })}
        onRequestClose={() => {
          setPaneState({ isPaneOpen: false })
          setVideoSrc(null)
          window.api.setDiscordRpc({ ...discordRpcActivity })
        }}
        overlayClassName=""
        className="bg-black font-space-mono"
        width="100%"
      >
        {paneState.isPaneOpen && (
          <AnimePahePlayerEmbedded
            videoSrc={videoSrc}
            animeData={{
              idMal,
              episode
            }}
          />
        )}
      </SlidingPane>
      {active && (
        <div className="mx-3 my-3 flex flex-col gap-y-2">
          {isLoading && <Skeleton width={'50%'} className="mb-1" />}
          {error && <p className="font-space-mono text-red-500">{t('animePaheEpisode.fetchError')}</p>}
          {!isLoading && episodePlayData?.length === 0 && (
            <p className="font-space-mono text-red-500">{t('animePaheEpisode.noEpisodes')}</p>
          )}
          {episodePlayData?.map((epdata) => (
            <div
              key={epdata.videoSrc}
              className="group flex animate-fade-down cursor-pointer flex-row justify-between gap-y-1 border-2 border-[#2c2d3c] bg-[#111113] px-2 py-2 transition-all duration-150 ease-in-out animate-duration-500 hover:border-[#c084fc90]" //0f1012
              // onClick={() => navigate(`/animepahe/player/${encodeURIComponent(epdata.videoSrc)}`)}
              onClick={() => {
                // Open Sliding Pane and set video src - NOT WORKING
                // setPaneState({ isPaneOpen: true })
                // setVideoSrc(epdata.videoSrc)
              }}
            >
              <div className="flex items-center gap-7">
                <p className="min-w-28 font-space-mono text-sm tracking-wide opacity-55 transition-all duration-150 ease-in-out group-hover:text-purple-400 group-hover:opacity-100">
                  {epdata.fansub}
                </p>
                <p
                  className={`min-w-16 text-center text-sm tracking-wider ${epdata.resolution === '1080' ? 'text-green-500' : ''} ${
                    epdata.resolution === '720' ? 'text-blue-500' : ''
                  } ${epdata.resolution === '360' ? 'text-yellow-500' : ''} `}
                >
                  {epdata.resolution}p
                </p>
                <Code
                  color={epdata.audio === 'jpn' ? 'green' : 'blue'}
                  variant="soft"
                  size="1"
                  style={{
                    // tracking
                    letterSpacing: '0.1em',
                    padding: '0.2em 0.5em'
                  }}
                >
                  {epdata.audio.toUpperCase()}
                </Code>

                {/* Stream on App - NOT WORKING */}
                {/* <Tooltip content="Not working as of now !">
                  <Button variant="soft" size="1" color="violet" className="text-xs">
                    Stream on App
                  </Button>
                </Tooltip> */}

                {/* External Player - NOT WORKING */}
                {/* <Button
                  variant="soft"
                  size="1"
                  color="mint"
                  className="text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    // if (knownPlayers.some((player) => vlcPath.includes(player))) {
                    //   window.api.openVlc(
                    //     `${vlcPath} --title "${sanitize(`${anime_title} - Episode: ${episode}`)}" ${epdata.videoSrc}`
                    //   )
                    // } else
                    window.api.openVlc(`${vlcPath} ${epdata.videoSrc}`)
                  }}
                >
                  Stream on External Player
                </Button> */}
              </div>
              <Link target="_blank" to={`${epdata.kwikSrc}`}>
                <Button
                  variant="outline"
                  size="1"
                  color="gray"
                  className="text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                  style={{
                    cursor: 'pointer'
                  }}
                >
                  {t('animePaheEpisode.openInBrowser')}
                  <OpenInNewWindowIcon className="ml-1" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
