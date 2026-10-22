import { Link, useNavigate, useParams } from 'react-router-dom'
import useGetAnimeById from '../hooks/useGetAnimeById'
import { format, formatDate, fromUnixTime, getUnixTime } from 'date-fns'
import { useEffect, useState } from 'react'
import CenteredLoader from '../ui/CenteredLoader'
import Episode from '../components/Episode'
import { Button, DropdownMenu, Skeleton } from '@radix-ui/themes'
import { toast } from 'sonner'
import { ExclamationTriangleIcon, PersonIcon, StarIcon } from '@radix-ui/react-icons'
import useGetAniZipMappings from '../hooks/useGetAniZipMappings'
import useGetAnimeByMalId from '../hooks/useGetAnimeByMalId'
import { autop } from '@wordpress/autop'
import parse from 'html-react-parser'
import { useKaizenContext } from '../utils/ContextProvider'
import AniListLogo from '../assets/symbols/AniListLogo'
import MyAnimeListLogo from '../assets/symbols/MyAnimeListLogo'
import YouTubeLogo from '../assets/symbols/YouTubeLogo'
import AnilistEditorModal from '../components/AnilistEditorModal'
import BooksLogo from '../assets/symbols/BooksLogo'
import Pagination from '../components/Pagination'
import CustomSearch from '../components/CustomSearch'
import { t, dateLocale } from '../i18n'
import { formatLabel, genreLabel, seasonLabel, statusLabel } from '../i18n/anilistLabels'
import { BRAND } from '../brand'
import useTranslatedText from '../hooks/useTranslatedText'
import { asSeason, groupEpisodesBySeason } from '../utils/seasons'

const RELATION_LABELS = {
  ADAPTATION: t('animePage.relation.ADAPTATION'),
  PREQUEL: t('animePage.relation.PREQUEL'),
  SEQUEL: t('animePage.relation.SEQUEL'),
  PARENT: t('animePage.relation.PARENT'),
  SIDE_STORY: t('animePage.relation.SIDE_STORY'),
  CHARACTER: t('animePage.relation.CHARACTER'),
  SUMMARY: t('animePage.relation.SUMMARY'),
  ALTERNATIVE: t('animePage.relation.ALTERNATIVE'),
  SPIN_OFF: t('animePage.relation.SPIN_OFF'),
  OTHER: t('animePage.relation.OTHER'),
  SOURCE: t('animePage.relation.SOURCE'),
  COMPILATION: t('animePage.relation.COMPILATION'),
  CONTAINS: t('animePage.relation.CONTAINS')
}
const relationLabel = (type) => RELATION_LABELS[type] || type?.replace('_', ' ')

export default function AnimePage() {
  const kaizenContext = useKaizenContext()
  const { glow } = kaizenContext

  const animeId = useParams().animeId
  const { isLoading, animeData, error, status } = useGetAnimeById(animeId)
  const malId = animeData?.idMal
  // const episodesWatched = animeData?.mediaListEntry?.progress || 0
  const [episodesWatched, setEpisodesWatched] = useState(animeData?.mediaListEntry?.progress || 0)

  useEffect(() => {
    setEpisodesWatched(animeData?.mediaListEntry?.progress || 0)
  }, [animeData?.mediaListEntry?.progress])

  const [quality, setQuality] = useState('All')
  const {
    isLoading: isLoadingMappings,
    data: mappingsData,
    error: errorMappings,
    status: statusMappings
  } = useGetAniZipMappings(animeId)

  const {
    isLoading: isLoadingMalId,
    data: malIdData,
    error: errorMalId,
    status: statusMalId
  } = useGetAnimeByMalId(malId || null)

  // the synopsis comes from the API in English: show a machine translation in Portuguese
  const rawDescription = malIdData?.data?.synopsis || animeData?.description || ''
  const { translated: translatedDescription, loading: translatingDescription } = useTranslatedText(
    rawDescription,
    kaizenContext.backendPort
  )
  const [showOriginalDescription, setShowOriginalDescription] = useState(false)

  let episodesAnizip = mappingsData?.episodes
  let aniZip_titles = {
    en: '',
    ja: '',
    xJat: '',
    malTitleRomaji: '',
    malTitleEnglish: ''
  }
  if (mappingsData?.titles) {
    aniZip_titles.en = mappingsData?.titles?.en || ''
    aniZip_titles.ja = mappingsData?.titles?.ja || ''
    aniZip_titles.xJat = mappingsData?.titles['x-jat'] || ''
    aniZip_titles.malTitleRomaji = malIdData?.data?.titles[0]?.title || ''
    aniZip_titles.malTitleEnglish = malIdData?.data?.titles[4]?.title || ''
  }

  if (episodesAnizip) {
    episodesAnizip = Object.keys(episodesAnizip)?.map((key) => episodesAnizip[key])
    let tempEps = episodesAnizip.map((ep) => {
      if (isNaN(ep.episode)) return null
      return {
        epNum: ep.episode,
        title: ep.title.en || ep.title['x-jat'] || ep.title.jp || t('animePage.episodeN', { n: ep.episode }),
        thumbnail: ep.image,
        airdate: ep.airdate,
        overview: ep.overview,
        aids: mappingsData?.mappings?.anidb_id,
        eids: ep.anidbEid,
        season: asSeason(ep.seasonNumber) // season / arc of the episode (TVDB numbering), if known
      }
    })

    // remove null values
    tempEps = tempEps.filter((ep) => ep !== null)

    // AniList knows how many episodes have aired; add the ones the mapping doesn't list yet
    let airedCount = 0
    if (animeData?.status === 'FINISHED') airedCount = animeData?.episodes || 0
    else if (animeData?.nextAiringEpisode?.episode) airedCount = animeData.nextAiringEpisode.episode - 1
    const known = new Set(tempEps.map((ep) => Number(ep.epNum)))
    for (let n = 1; n <= airedCount; n++) {
      if (known.has(n)) continue
      tempEps.push({
        epNum: String(n),
        title: t('animePage.episodeN', { n }),
        thumbnail: undefined,
        airdate: undefined,
        overview: undefined,
        aids: mappingsData?.mappings?.anidb_id,
        eids: null,
        season: null
      })
    }
    tempEps.sort((a, b) => Number(a.epNum) - Number(b.epNum))

    episodesAnizip = tempEps
  }
  const navigate = useNavigate()
  const [dualAudio, setDualAudio] = useState(false)
  const [hideWatchedEpisodes, setHideWatchedEpisodes] = useState(false)
  const [showFullDescription, setShowFullDescription] = useState(false)
  const [showRelations, setShowRelations] = useState(false)

  const [pageSize, setPageSize] = useState(100)
  const [pageNo, setPageNo] = useState(0)
  const [seasonSel, setSeasonSel] = useState('all') // 'all' | index of the chosen season group
  // a different anime starts from the whole list again
  useEffect(() => {
    setSeasonSel('all')
    setPageNo(0)
  }, [animeId])

  const activityDetails = {
    details: `${animeData?.title.romaji} • ${malIdData?.data?.title_japanese || animeData?.title.native || ''}`,
    state: t('animePage.discordBrowsing', { title: animeData?.title.romaji }),
    assets: {
      large_image: animeData?.coverImage?.medium || animeData?.coverImage.extraLarge,
      small_image: 'logo',
      small_text: BRAND.name
    }
  }

  function setDiscordRPC() {
    if (!animeData) return
    window.api.setDiscordRpc(activityDetails)
  }

  useEffect(() => {
    setDiscordRPC()
    return () => {
      window.api.setDiscordRpc({ details: t('animePage.discordBrowsingAnime') })
    }
  }, [animeData, episodesWatched, malIdData])

  if (isLoading) return <CenteredLoader />

  if (errorMappings || errorMalId) {
    toast.error(t('animePage.fetchError'), {
      icon: <ExclamationTriangleIcon height="16" width="16" color="#ffffff" />,
      description: t('animePage.fetchErrorDesc', {
        message: errorMappings?.message || errorMalId?.message
      }),
      classNames: {
        title: 'text-rose-500'
      }
    })
  }

  if (error) {
    throw new Error(error)
  }

  if (status !== 'success') return <CenteredLoader />

  const relations = animeData?.relations?.edges.filter((edge) => edge.node.type === 'ANIME')

  const data = animeData

  const startDate = data?.startDate
    ? new Date(data.startDate.year, data.startDate.month - 1, data.startDate.day)
    : null

  const endDate = data?.endDate
    ? new Date(data.endDate.year, data.endDate.month - 1, data.endDate.day)
    : null

  let animeEpisodes = data?.streamingEpisodes
  animeEpisodes?.sort((a, b) => {
    const aNum = parseInt(a.title.split(' ')[1])
    const bNum = parseInt(b.title.split(' ')[1])
    return aNum - bNum
  })

  // if (!animeEpisodes) {
  // animeEpisodes = episodesAnizip;
  // } else if (episodesAnizip.length >= animeEpisodes.length) {
  animeEpisodes = episodesAnizip
  // }

  // long anime come with seasons / arcs: let the list be narrowed to one of them
  const seasonGroups = groupEpisodesBySeason(animeEpisodes || [])
  const activeGroup = seasonGroups.length > 1 && seasonSel !== 'all' ? seasonGroups[seasonSel] : undefined
  const visibleEpisodes = activeGroup
    ? animeEpisodes.slice(activeGroup.start, activeGroup.end + 1)
    : animeEpisodes
  const episodeOffset = activeGroup ? activeGroup.start : 0 // position of the first shown episode in the full list
  const chooseSeason = (value) => {
    setSeasonSel(value)
    setPageNo(0)
  }

  const genresString = data?.genres?.map(genreLabel).join(', ') || ''

  return (
    <div className="relative">
      {/* {false && ( */}
      {data?.bannerImage && (
        // <div className="p-4 px-8">
        <div className="relative">
          {glow && (
            <div className="animate-fade-down">
              <img
                src={data?.bannerImage}
                className="absolute top-7 z-0 h-72 w-full object-cover opacity-70 blur-3xl brightness-75 saturate-150 2xl:h-96"
                alt=""
              />
            </div>
          )}
          <img
            src={data?.bannerImage}
            className="z-10 h-72 w-full animate-fade-down object-cover brightness-90 transition-all ease-in-out 2xl:h-96"
            alt=""
          />
        </div>
      )}
      <div className="z-30 mx-auto animate-fade px-6 py-4 lg:container">
        <div className="flex justify-between gap-x-7">
          <img
            src={data?.coverImage.extraLarge}
            alt=""
            className={`duration-400 relative ${data?.bannerImage ? 'bottom-[4rem]' : ''} shadow-xl drop-shadow-2xl h-[25rem] w-72 animate-fade-up rounded-md object-cover transition-all ease-in-out`}
            // className={`duration-400 relative h-96 w-72 animate-fade rounded-md object-cover transition-all ease-in-out`}
          />
          <div className="flex-1 justify-start gap-y-0">
            <p className="font-space-mono text-xl font-medium tracking-wider">
              {data?.title.romaji}
            </p>
            <p className="text mb-2 border-b border-[#545454] pb-2 font-space-mono font-medium tracking-wider opacity-80">
              {data?.title.english}
              {data?.title?.native ? ` • ${data?.title?.native}` : ''}
            </p>
            {/* <div className="my-3 h-[1px] w-full bg-[#333]"></div> Divider */}
            <div className="mb-2 flex w-fit items-center gap-x-2 border-b border-[#545454] pb-2 text-xs text-gray-300">
              <p className="">{formatLabel(data?.format)}</p>
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              <p>{t('animePage.episodesCount', { count: data?.episodes ? data?.episodes : '?' })}</p>
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              <p>({statusLabel(data?.status)})</p>
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              <p className="text-xs opacity-60">
                {data &&
                  format(new Date(startDate), t('animePage.dateMonthYear'), { locale: dateLocale() })}
              </p>
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              <p className="opacity-60">{seasonLabel(data?.season)}</p>
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              {data.averageScore && (
                <>
                  <div className="flex gap-x-1 tracking-wide opacity-90">
                    <StarIcon /> {data.averageScore} / 100
                  </div>
                  <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
                </>
              )}
              <div className="flex gap-x-1 tracking-wide opacity-90">
                <PersonIcon />
                {data.popularity.toLocaleString()}
              </div>
            </div>
            {genresString && (
              <div className="mb-2 flex w-fit gap-x-1 border-b border-[#545454] pb-2 font-space-mono text-xs tracking-wide opacity-90">
                {genresString}{' '}
                {data?.airingSchedule?.nodes[0]?.episode
                  ? ` • ${t('animePage.nextEpisode', {
                      n: data?.airingSchedule.nodes[0].episode,
                      date: format(
                        fromUnixTime(data?.airingSchedule.nodes[0].airingAt),
                        t('animePage.dateTime'),
                        { locale: dateLocale() }
                      )
                    })}`
                  : ''}
              </div>
            )}

            <div
              className={`relative flex ${showFullDescription ? '' : 'max-h-[9.55rem]'} flex-col gap-y-2 overflow-hidden pb-6 font-space-mono text-sm opacity-55 transition-all`}
              onClick={() => setShowFullDescription(!showFullDescription)}
            >
              {parse(
                autop(
                  (translatedDescription && !showOriginalDescription ? translatedDescription : rawDescription) ||
                    t('animePage.noDescription')
                )
              )}
              {!showFullDescription && (
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#111113] to-transparent" />
              )}
            </div>
            {(translatedDescription || translatingDescription) && (
              <p className="mt-1 font-space-mono text-xs opacity-50">
                {translatingDescription
                  ? t('animePage.descTranslating')
                  : showOriginalDescription
                    ? t('animePage.descOriginal')
                    : t('animePage.descAuto')}{' '}
                {translatedDescription && (
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setShowOriginalDescription((v) => !v)}
                  >
                    {showOriginalDescription ? t('animePage.descShowTranslation') : t('animePage.descShowOriginal')}
                  </button>
                )}
              </p>
            )}
            <div className="mt-6 flex items-center gap-x-5">
              {relations?.length > 0 && (
                <Button
                  size={'1'}
                  variant="ghost"
                  color={showRelations ? 'blue' : 'gray'}
                  onClick={() => setShowRelations(!showRelations)}
                >
                  <BooksLogo />
                </Button>
              )}
              <Link target="_blank" to={`https://anilist.co/anime/${data?.id}`}>
                <Button size={'1'} variant="ghost" color="gray">
                  <AniListLogo />
                </Button>
              </Link>
              {malIdData?.data?.url && (
                <Link target="_blank" to={malIdData?.data?.url}>
                  <Button size={'1'} variant="ghost" color="gray">
                    <MyAnimeListLogo />
                  </Button>
                </Link>
              )}
              {data?.trailer?.site === 'youtube' && (
                <Link target="_blank" to={`https://www.youtube.com/watch?v=${data?.trailer.id}`}>
                  <Button size={'1'} variant="ghost" color="gray">
                    <YouTubeLogo />
                  </Button>
                </Link>
              )}
              <div className="h-5 w-[1px] bg-[#333]"></div> {/* Divider */}
              {/* ANILIST Episode Manager */}
              <AnilistEditorModal
                anilist_data={data}
                setEpisodesWatchedMainPage={setEpisodesWatched}
              />
            </div>
          </div>
        </div>

        {relations && showRelations && (
          <div
            className={`grid ${data?.bannerImage ? '' : 'mt-14'} h-full w-full animate-fade grid-cols-2 animate-duration-300 xl:grid-cols-3`}
          >
            {relations.map((relation, ix) => (
              <div
                key={ix}
                className="my-2 h-fit cursor-pointer transition-all duration-200 ease-in-out"
                onClick={() => navigate(`/anime/${relation?.node?.id}`)}
              >
                <div className="flex w-[25rem] font-space-mono text-xs text-[#dcdcdc]">
                  <Skeleton
                    style={{
                      borderRadius: '0rem'
                    }}
                  >
                    <img
                      src={relation?.node?.coverImage?.medium}
                      alt=""
                      className="h-28 w-20 object-cover transition-all ease-in-out"
                    />
                  </Skeleton>
                  <div className="flex w-full flex-col items-start border border-gray-700 py-2 pl-2">
                    <p className="line-clamp-3 pr-3">{relation?.node?.title?.userPreferred}</p>
                    <p
                      className={`my-2 line-clamp-3 border ${
                        ['text-cyan-400', 'text-orange-400'][
                          ['SEQUEL', 'PREQUEL'].indexOf(relation?.relationType)
                        ]
                      } border-[#545454] bg-[#00000080] px-1`}
                    >
                      {relationLabel(relation?.relationType)}{' '}
                      {relation?.node?.seasonYear ? ` | ${relation?.node?.seasonYear}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {true && (
          <div className="mb-96 mt-12">
            <div className="flex items-center gap-x-3">
              <p className="font-space-mono text-lg font-medium opacity-90">{t('animePage.episodes')}</p>
              <Button
                variant="soft"
                size={'1'}
                onClick={() => setDualAudio(!dualAudio)}
                color={dualAudio ? 'blue' : 'gray'}
              >
                {t('animePage.dub')}
              </Button>
              <Button
                variant="soft"
                size={'1'}
                onClick={() => setHideWatchedEpisodes(!hideWatchedEpisodes)}
                color={hideWatchedEpisodes ? 'blue' : 'gray'}
              >
                {t('animePage.hideWatched')}
              </Button>
              <DropdownMenu.Root className="nodrag" modal={false}>
                <DropdownMenu.Trigger>
                  <Button variant="soft" color="gray" size={'1'}>
                    <div className="flex animate-fade items-center gap-x-2">{t('animePage.quality', { quality: quality === 'All' ? t('animePage.all') : quality })}</div>
                    <DropdownMenu.TriggerIcon />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    color={`${quality === 'All' ? 'indigo' : 'gray'}`}
                    onClick={() => setQuality('All')}
                  >
                    {t('animePage.all')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    color={`${quality === '2160p' ? 'indigo' : 'gray'}`}
                    shortcut="4K"
                    onClick={() => setQuality('2160p')}
                  >
                    2160p
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    color={`${quality === '1080p' ? 'indigo' : 'gray'}`}
                    shortcut="HD"
                    onClick={() => setQuality('1080p')}
                  >
                    1080p
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    color={`${quality === '720p' ? 'indigo' : 'gray'}`}
                    shortcut="SD"
                    onClick={() => setQuality('720p')}
                  >
                    720p
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              {seasonGroups.length > 1 && (
                <DropdownMenu.Root className="nodrag" modal={false}>
                  <DropdownMenu.Trigger>
                    <Button variant="soft" color="gray" size={'1'}>
                      <div className="flex animate-fade items-center gap-x-2">
                        {activeGroup
                          ? t('animePage.seasonN', { n: activeGroup.season ?? '?' })
                          : t('animePage.seasonAll')}
                      </div>
                      <DropdownMenu.TriggerIcon />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      color={seasonSel === 'all' ? 'indigo' : 'gray'}
                      shortcut={`1–${animeEpisodes.length}`}
                      onClick={() => chooseSeason('all')}
                    >
                      {t('animePage.seasonAll')}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    {seasonGroups.map((group, i) => (
                      <DropdownMenu.Item
                        key={i}
                        // green: the season that has the next episode to watch
                        color={
                          seasonSel === i
                            ? 'indigo'
                            : episodesWatched >= group.start && episodesWatched <= group.end
                              ? 'green'
                              : 'gray'
                        }
                        shortcut={`${group.from}–${group.to}`}
                        onClick={() => chooseSeason(i)}
                      >
                        {t('animePage.seasonItem', { n: group.season ?? '?' })}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              )}
              <Pagination
                arraySize={visibleEpisodes?.length}
                pageSize={pageSize}
                setPageSize={setPageSize}
                pageNo={pageNo}
                setPageNo={setPageNo}
                position={'relative'}
                progress={episodesWatched - episodeOffset}
              />
              <CustomSearch
                anime={data.title}
                animeId={data.id}
                data={{
                  progress: episodesWatched,
                  hideWatchedEpisodes,
                  quality
                }}
                bannerImage={data?.bannerImage}
                animeCoverImage={data?.coverImage?.extraLarge}
              />
            </div>
            {!isLoadingMappings && (
              <div className="mt-3 grid grid-cols-1 gap-y-3">
                <Episode
                  all={true}
                  anime={data.title}
                  dualAudio={dualAudio}
                  data={{ aids: mappingsData?.mappings?.anidb_id, quality, eids: 0 }}
                  bannerImage={data?.bannerImage}
                  animeCoverImage={data?.coverImage?.extraLarge}
                  discordRpcActivity={activityDetails}
                />
                {/* {animeEpisodes?.map((episode, ix) => ( */}
                {/* {animeEpisodes
                  ?.slice(pageNo * pageSize, pageNo * pageSize + pageSize)
                  ?.map((episode, ix) => (
                    <Episode
                      key={'ep -' + ix + pageNo * pageSize}
                      anime={data.title}
                      animeId={data.id}
                      data={{
                        ...episode,
                        progress: episodesWatched,
                        hideWatchedEpisodes,
                        quality
                      }}
                      dualAudio={dualAudio}
                      episodeNumber={ix + 1 + pageNo * pageSize}
                      aniZip_titles={aniZip_titles}
                      bannerImage={data?.bannerImage}
                      animeCoverImage={data?.coverImage?.extraLarge}
                      discordRpcActivity={activityDetails}
                    />
                  ))} */}
                {visibleEpisodes
                  ?.slice(pageNo * pageSize, pageNo * pageSize + pageSize)
                  ?.map((episode, ix) => (
                    <Episode
                      key={'ep -' + episodeOffset + '-' + ix + pageNo * pageSize}
                      anime={data.title}
                      animeId={data.id}
                      data={{
                        ...episode,
                        progress: episodesWatched,
                        hideWatchedEpisodes,
                        quality
                      }}
                      dualAudio={dualAudio}
                      // position in the WHOLE list, so progress and the player keep the real episode number
                      episodeNumber={episodeOffset + ix + 1 + pageNo * pageSize}
                      aniZip_titles={aniZip_titles}
                      bannerImage={data?.bannerImage}
                      animeCoverImage={data?.coverImage?.extraLarge}
                      discordRpcActivity={activityDetails}
                    />
                  ))}
              </div>
            )}
            {isLoadingMappings && <Skeleton className="mt-3 h-12" />}
          </div>
        )}
      </div>
    </div>
  )
}
