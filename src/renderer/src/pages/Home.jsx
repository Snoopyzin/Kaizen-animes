import AnimeCard from '../components/AnimeCard'
import useTopAiringAnime from '../hooks/useTopAiringAnime'
// import kaizen1 from '../assets/kaizen2.png'
import KaizenLogo from '../components/KaizenLogo'
import { BRAND } from '../brand'
import TranslatedDescription from '../components/TranslatedDescription'
import InfiniteScroll from 'react-infinite-scroll-component'
import { getTopAnime, searchAnilist } from '../utils/helper'
import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button, Spinner } from '@radix-ui/themes'
import { toast } from 'sonner'
import { ExclamationTriangleIcon, PersonIcon, StarIcon, VideoIcon } from '@radix-ui/react-icons'
import SkeletonAnimeCard from '../skeletons/SkeletonAnimeCard'
import { getCurrentSeason } from '../utils/currentSeason'
import { Carousel } from 'react-responsive-carousel'
import 'react-responsive-carousel/lib/styles/carousel.min.css'
import { useNavigate } from 'react-router-dom'
import useGetRecentGlobalActivity from '../hooks/useGetRecentGlobalActivity'
import RecentActivity from '../components/RecentActivity'
import { useKaizenContext } from '../utils/ContextProvider'
import useGetAnilistSearch from '../hooks/useGetAnilistSearch'
import CurrentlyWatchingCard from '../components/CurrentlyWatchingCard'
import { t } from '../i18n'
import { formatLabel } from '../i18n/anilistLabels'

export default function Home() {
  const { scrollOpacity, hideHero, userId } = useKaizenContext()

  const {
    isLoading: isLoadingRecentActivity,
    data: recentActivity,
    error: errorRecentActivity,
    status: statusRecentActivity
  } = useGetRecentGlobalActivity()

  // State to store background opacity
  const [bgOpacity, setBgOpacity] = useState(1)

  useEffect(() => {
    if (scrollOpacity === false) return
    const handleScroll = () => {
      const scrollY = window.scrollY
      // setScrollY(scrollY)
      // Adjust the value as per your requirement, this reduces opacity with scroll
      const newOpacity = Math.max(0, 1 - scrollY / 500) // Minimum opacity is 0.3
      setBgOpacity(newOpacity)
    }

    window.addEventListener('scroll', handleScroll)

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [scrollOpacity])

  // const { isLoading, topAiringAnime, error, status } = useTopAiringAnime()
  // media(type: ANIME, sort: TRENDING_DESC, status_in: [RELEASING], isAdult: false)
  const {
    isLoading,
    data: topAiringAnime,
    error,
    status
  } = useGetAnilistSearch(
    {
      sort: 'POPULARITY_DESC',
      status_in: '[RELEASING]',
      isAdult: 'false',
      format_not: 'MUSIC',
      season: getCurrentSeason()
    },
    1,
    49
  )

  const {
    isLoadingCurrentlyWatching,
    data: currentlyWatching,
    errorCurrentlyWatching
  } = useGetAnilistSearch(
    userId
      ? {
          isAdult: 'false',
          watchStatus: 'CURRENT',
          userId: userId
        }
      : {}
  )

  // get current year and season
  const currentYear = new Date().getFullYear()
  // season: WINTER, SPRING, SUMMER, FALL
  const currentSeason = getCurrentSeason()

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    error: infiniteQueryError
  } = useInfiniteQuery({
    queryKey: ['top_animes'],
    queryFn: ({ pageParam = 1 }) =>
      searchAnilist({ sort: 'POPULARITY_DESC', isAdult: false }, pageParam),

    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      return allPages.length + 1
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 // 1 hour
  })

  // if (infiniteQueryError) {
  //   toast.error('Error fetching Top Animes', {
  //     icon: <ExclamationTriangleIcon height="16" width="16" color="#ffffff" />,
  //     description: infiniteQueryError?.message,
  //     classNames: {
  //       title: 'text-rose-500'
  //     }
  //   })
  // }

  useEffect(() => {
    if (errorRecentActivity) {
      toast.error(t('home.recentActivityError'), {
        id: 'home-recent-activity-error', // one toast, not one per retry
        icon: <ExclamationTriangleIcon height="16" width="16" color="#ffffff" />,
        description: errorRecentActivity?.message,
        classNames: {
          title: 'text-rose-500'
        }
      })
    }

    if (infiniteQueryError) {
      toast.error(t('home.topAnimeError'), {
        id: 'home-top-anime-error',
        icon: <ExclamationTriangleIcon height="16" width="16" color="#ffffff" />,
        description: infiniteQueryError?.message,
        classNames: {
          title: 'text-rose-500'
        }
      })
    }
  }, [errorRecentActivity, infiniteQueryError])

  const [topAnime, setTopAnime] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    if (data) {
      const newTopAnime = data.pages
        .map((page) => page)
        .flat()
        .filter(Boolean)
      setTopAnime(newTopAnime)
    }
  }, [data])

  return (
    <div className="select-none font-space-mono tracking-tight">
      {!hideHero && (
        <div
          className="relative flex min-h-[96svh] animate-fade flex-col items-center justify-center gap-x-24 gap-y-11 lg:flex-row"
          style={
            {
              // backgroundImage: `url(${gradient1})`,
              // backgroundSize: 'cover',
              // background: `linear-gradient(rgba(17,17,19,${1 - bgOpacity}), rgba(17,17,19,${1 - bgOpacity})), url(${gradient1})`
            }
          }
        >
          <div
            className="stroke-text absolute top-[-200px] w-full overflow-hidden text-nowrap text-[22rem] text-[#ffffff20]"
            style={{
              opacity: bgOpacity
              // if scrollOpacity is false, then do not change opacity on scroll
              // opacity: scrollOpacity ? bgOpacity : 1
            }}
          >
            {BRAND.jp}
            {BRAND.jp}
            {BRAND.jp}
          </div>
          <div
            className="stroke-text absolute w-full overflow-hidden text-nowrap text-[22rem] text-[#ffffff20]"
            style={{
              // opacity: scrollOpacity ? bgOpacity : 1
              opacity: bgOpacity
            }}
          >
            {BRAND.name.toUpperCase()} {BRAND.name.toUpperCase()} {BRAND.name.toUpperCase()}
          </div>
          <div
            className="stroke-text absolute bottom-[-200px] w-full overflow-hidden text-nowrap text-[22rem] text-[#ffffff20]"
            style={{
              // opacity: scrollOpacity ? bgOpacity : 1
              opacity: bgOpacity
            }}
          >
            七転び八起き
          </div>

          <div className="my-12 flex h-full w-8/12 flex-col items-center justify-start gap-y-1 p-3 lg:w-2/5">
            <KaizenLogo size={96} className="drop-shadow-xl" />
            <p className="text-center font-space-mono">
              {/* Stream your favourite anime instantly with our service, no waiting for downloads,
              reliable and seamless streaming directly to the app / External Media Player. */}
              {t('home.tagline')}
            </p>
          </div>

          {/* <img
          src={kaizen1}
          alt="kaizen"
          className="drop-shadow-lg h-48 object-scale-down sm:h-64 md:h-80 lg:h-96"
        /> */}

          {recentActivity && <RecentActivity data={Object.values(recentActivity).slice(0, 9)} />}
        </div>
      )}

      {topAiringAnime?.length > 0 && (
        <div
          className={`w-full`}
          style={{
            // opacity: 1 - bgOpacity
            opacity: scrollOpacity ? 1 - bgOpacity : 1
          }}
        >
          <div className="animate-fade">
            <Carousel
              axis="horizontal"
              showArrows={true}
              showThumbs={false}
              autoPlay
              interval={5000}
              infiniteLoop
              renderIndicator={false}
              emulateTouch
              statusFormatter={(current, total) => t('home.carouselStatus', { current, total })}
            >
              {topAiringAnime
                ?.filter(
                  (anime) =>
                    anime.seasonYear === currentYear &&
                    anime.season.toLowerCase() === currentSeason.toLowerCase() &&
                    anime.bannerImage !== null
                )
                .slice(0, 5)
                .map((anime) => (
                  // gradient from left to right black to transparent
                  <div
                    key={anime.id + 'bannerAnime'}
                    className="relative h-72 cursor-pointer 2xl:h-96"
                    onClick={() => navigate(`/anime/${anime.id}`, { state: { data: anime } })}
                  >
                    <div className="mask absolute h-full w-8/12 bg-gradient-to-r from-[#141414] backdrop-blur-md"></div>
                    <div className="absolute ml-5 flex h-full flex-col items-start justify-center gap-y-2 px-2 2xl:gap-y-6">
                      <div className="line-clamp-1 max-w-xl bg-gradient-to-r from-[#14141480] py-1 text-start text-2xl font-semibold tracking-wider text-white drop-shadow-3xl">
                        {anime.title.romaji}
                      </div>
                      <div className="mb-4 line-clamp-1 max-w-2xl text-start text-xs tracking-wider text-white drop-shadow-3xl">
                        {anime.title.english}
                      </div>

                      {anime.description && (
                        <div className="line-clamp-[9] w-80 text-left text-xs tracking-wide">
                          <TranslatedDescription html={anime.description} />
                        </div>
                      )}

                      <div className="flex gap-x-8 border border-[#ffffff70] bg-[#00000050] px-1 py-1 text-xs backdrop-blur-[2px]">
                        <div>{t('home.episodes', { count: anime.episodes || 0 })}</div>
                        {anime.averageScore && (
                          <div className="flex items-center gap-x-1 tracking-wide">
                            <StarIcon /> {anime.averageScore} / 100
                          </div>
                        )}
                        <div className="flex items-center gap-x-1 tracking-wide">
                          <PersonIcon />
                          {anime.popularity.toLocaleString()}
                        </div>
                        <div className="flex items-center gap-x-1 tracking-wide">
                          <VideoIcon className="h-4 w-4 text-white" />
                          {formatLabel(anime.format)}
                        </div>
                      </div>
                    </div>
                    <img
                      src={anime.bannerImage}
                      alt=""
                      className="h-72 w-full object-cover 2xl:h-96"
                    />
                  </div>
                ))}
            </Carousel>
          </div>
        </div>
      )}

      {error && (
        <div className="text-red-500">{t('home.airingError', { message: error.message })}</div>
      )}

      {userId && currentlyWatching?.length > 0 && (
        <div className="mx-3 mt-4">
          <div className="mb-2 ml-5 border-b border-gray-700 pb-1 font-space-mono text-lg font-bold tracking-wider">
            {t('home.continueWatching')}
          </div>
          <div className="grid animate-fade grid-cols-3">
            {currentlyWatching?.slice(0, 3)?.map((anime) => (
              <CurrentlyWatchingCard key={anime.id + 'currentlyWatching'} data={anime} />
            ))}
          </div>
        </div>
      )}

      {/* {status === 'success' && !error && ( */}
      {!error && (
        <div className="mx-5 mt-8">
          <div className="mb-2 border-b border-gray-700 pb-1 font-space-mono text-lg font-bold tracking-wider">
            {t('home.airing')}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-4 overflow-x-visible pl-4">
            {!isLoading &&
              !error &&
              topAiringAnime?.map((anime) => (
                <AnimeCard key={anime.id + 'topAiringAnime'} data={anime} />
              ))}
            {isLoading && (
              <>
                <SkeletonAnimeCard />
                <SkeletonAnimeCard />
                <SkeletonAnimeCard />
                <SkeletonAnimeCard />
                <SkeletonAnimeCard />
                <SkeletonAnimeCard />
                <SkeletonAnimeCard />
              </>
            )}
          </div>
        </div>
      )}

      {infiniteQueryError && (
        <div className="text-red-500">{t('home.topAnimeFetchError', { message: infiniteQueryError.message })}</div>
      )}

      {!infiniteQueryError && topAnime?.length > 0 && (
        <div className="mx-5 mt-12">
          <div className="mb-2 border-b border-gray-700 pb-1 font-space-mono text-lg font-bold tracking-wider">
            {t('home.topAnime')}
          </div>

          <div className={`mb-2 w-full`}>
            <div className="animate-fade">
              <Carousel
                axis="horizontal"
                showArrows={true}
                showThumbs={false}
                autoPlay
                interval={5000}
                infiniteLoop
                renderIndicator={false}
                emulateTouch
                statusFormatter={(current, total) => t('home.carouselStatus', { current, total })}
              >
                {topAnime.slice(0, 8).map((anime) => (
                  // gradient from left to right black to transparent
                  <div
                    key={anime.id + 'bannerAnime'}
                    className="relative h-72 cursor-pointer 2xl:h-96"
                    onClick={() => navigate(`/anime/${anime.id}`, { state: { data: anime } })}
                  >
                    <div className="mask absolute h-full w-8/12 bg-gradient-to-r from-[#141414] backdrop-blur-md"></div>
                    <div className="absolute ml-5 flex h-full flex-col items-start justify-center gap-y-2 px-2 2xl:gap-y-6">
                      <div className="line-clamp-1 max-w-xl bg-gradient-to-r from-[#14141480] py-1 text-start text-2xl font-semibold tracking-wider text-white drop-shadow-3xl">
                        {anime.title.romaji}
                      </div>
                      <div className="mb-4 line-clamp-1 max-w-2xl text-start text-xs tracking-wider text-white drop-shadow-3xl">
                        {anime.title.english}
                      </div>

                      {anime.description && (
                        <div className="line-clamp-[9] w-80 text-left text-xs tracking-wide">
                          <TranslatedDescription html={anime.description} />
                        </div>
                      )}

                      <div className="flex gap-x-8 border border-[#ffffff70] bg-[#00000050] px-1 py-1 text-xs backdrop-blur-[2px]">
                        <div>{t('home.episodes', { count: anime.episodes || 0 })}</div>
                        {anime.averageScore && (
                          <div className="flex items-center gap-x-1 tracking-wide">
                            <StarIcon /> {anime.averageScore} / 100
                          </div>
                        )}
                        <div className="flex items-center gap-x-1 tracking-wide">
                          <PersonIcon />
                          {anime.popularity.toLocaleString()}
                        </div>
                        <div className="flex items-center gap-x-1 tracking-wide">
                          <VideoIcon className="h-4 w-4 text-white" />
                          {formatLabel(anime.format)}
                        </div>
                      </div>
                    </div>
                    <img
                      src={anime.bannerImage}
                      alt=""
                      className="h-72 w-full object-cover 2xl:h-96"
                    />
                  </div>
                ))}
              </Carousel>
            </div>
          </div>

          <InfiniteScroll
            style={{ all: 'unset' }}
            dataLength={topAnime?.length}
            next={() => fetchNextPage()}
            hasMore={topAnime?.length < 500}
            loader={
              <div className="flex items-center justify-center gap-x-2 overflow-hidden">
                <h4>{t('home.loading')}</h4>
                <Spinner />
              </div>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-4 overflow-x-visible pl-4">
              {topAnime?.map((anime) => {
                return <AnimeCard key={anime.id + 'topAnime'} data={anime} />
              })}
              {isFetching && (
                <>
                  <SkeletonAnimeCard />
                  <SkeletonAnimeCard />
                  <SkeletonAnimeCard />
                  <SkeletonAnimeCard />
                  <SkeletonAnimeCard />
                  <SkeletonAnimeCard />
                  <SkeletonAnimeCard />
                </>
              )}
            </div>
          </InfiniteScroll>
        </div>
      )}
    </div>
  )
}
