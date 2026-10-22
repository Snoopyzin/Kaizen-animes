import { useEffect, useState } from 'react'
import SkeletonAnimeCard from '../skeletons/SkeletonAnimeCard'
import AnimeCard from '../components/AnimeCard'
import InfiniteScroll from 'react-infinite-scroll-component'
import { Button, DropdownMenu, Spinner, TextField } from '@radix-ui/themes'
import {
  MagnifyingGlassIcon,
  OpenInNewWindowIcon,
  PersonIcon,
  StarIcon,
  TrashIcon,
  VideoIcon
} from '@radix-ui/react-icons'
import HTMLReactParser from 'html-react-parser/lib/index'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { searchAnilist } from '../utils/helper'
import ErrorElement from '../ui/ErrorElement'
import useGetAnilistProfile from '../hooks/useGetAnilistProfile'
import { useKaizenContext } from '../utils/ContextProvider'
import LeafLogo from '../assets/symbols/LeafLogo'
import TVLogo from '../assets/symbols/TVLogo'
import MountainsLogo from '../assets/symbols/MountainsLogo'
import CassetteTapeLogo from '../assets/symbols/CassetteTapeLogo'
import SortDescLogo from '../assets/symbols/SortDescLogo'
import EyeLogo from '../assets/symbols/EyeLogo'
import { t } from '../i18n'
import {
  genreLabel,
  statusLabel,
  seasonLabel,
  formatLabel,
  listStatusLabel
} from '../i18n/anilistLabels'

const statusMap = ['PLANNING', 'CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED']

const GENRE_KEYS = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller'
]
const FORMAT_KEYS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC']
const SEASON_KEYS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const STATUS_KEYS = ['RELEASING', 'NOT_YET_RELEASED', 'FINISHED', 'CANCELLED']
const SORT_KEYS = ['POPULARITY_DESC', 'SCORE_DESC', 'TRENDING_DESC']
const sortLabel = (v) => t('anilist.sort.' + v)

function Anilist() {
  // type: ANIME, search: $search, sort: $sort, onList: $onList, status: $status, status_not: $status_not, season: $season, seasonYear: $year, genre: $genre, format: $format, format_not: MUSIC
  const { userId } = useKaizenContext()
  console.log(userId)

  const [searchTerm, setSearchTerm] = useState('')
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [season, setSeason] = useState('')
  const [format, setFormat] = useState('')
  const [status, setStatus] = useState('')
  const [watchStatus, setWatchStatus] = useState('')
  const [sort, setSort] = useState('')
  const [year, setYear] = useState('')
  const [isAdult, setIsAdult] = useState(false)
  const [working, setWorking] = useState(true)

  const navigate = useNavigate()

  useEffect(() => {
    const storedSearchTerm = sessionStorage.getItem('search_term_stored')
    if (storedSearchTerm && storedSearchTerm !== '""') {
      setSearchTerm(storedSearchTerm)
    }

    const storedSearchParams = JSON.parse(sessionStorage.getItem('anilist_search_params'))
    if (storedSearchParams) {
      setTitle(storedSearchParams.title)
      setGenre(storedSearchParams.genre)
      setSeason(storedSearchParams.season)
      setFormat(storedSearchParams.format)
      setStatus(storedSearchParams.status)
      setWatchStatus(storedSearchParams.watchStatus)
      setSort(storedSearchParams.sort)
      setYear(storedSearchParams.year)
      setIsAdult(storedSearchParams.isAdult)
    }
  }, [])

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    error: infiniteQueryError
  } = useInfiniteQuery({
    queryKey: [
      'anilist_search',
      title,
      genre,
      season,
      format,
      status,
      sort,
      year,
      watchStatus,
      isAdult,
      userId
    ],
    queryFn: ({ pageParam = 1 }) =>
      searchAnilist(
        {
          search: title,
          genre,
          season,
          format,
          status,
          watchStatus,
          sort,
          seasonYear: year,
          isAdult,
          userId: statusMap.indexOf(watchStatus) !== -1 ? userId : null
        },
        pageParam
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      return allPages.length + 1
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 // 1 hour
  })

  useEffect(() => {
    console.log('searchTerm: ', searchTerm)
    console.log('title: ', title)

    if (searchTerm === title || searchTerm === '""') {
      setAnime([])
    }
    // store all the search params in session storage
    sessionStorage.setItem('search_term_stored', searchTerm)
    const obj = {
      title,
      genre,
      season,
      format,
      status,
      watchStatus,
      sort,
      year,
      isAdult
    }
    sessionStorage.setItem('anilist_search_params', JSON.stringify(obj))
  }, [
    useKaizenContext,
    userId,
    searchTerm,
    watchStatus,
    season,
    title,
    genre,
    format,
    status,
    sort,
    year,
    isAdult
  ])

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm !== title) {
        setAnime([])
      }
      if (searchTerm === '""') setTitle('')
      else setTitle(searchTerm)

      sessionStorage.setItem('search_term_stored', searchTerm)
    }, 500)

    return () => clearTimeout(delayDebounceFn)
  }, [searchTerm])

  const [anime, setAnime] = useState([])

  useEffect(() => {
    setWorking(false)
    if (data) {
      const newAnime = data.pages
        .map((page) => page)
        .flat()
        .filter(Boolean)
      setAnime(newAnime)
    }
  }, [data])

  function clearAll() {
    setGenre('')
    setSeason('')
    setFormat('')
    setStatus('')
    setWatchStatus('')
    setSort('')
    setYear('')
    setSearchTerm('')
    setTitle('')

    sessionStorage.removeItem('search_term_stored')
    sessionStorage.removeItem('anilist_search_params')
  }

  return (
    <div className="w-full select-none p-10 px-5 font-space-mono tracking-tight">
      <div className="flex w-full items-center justify-between gap-x-5">
        {/* <div className="flex w-fit items-center gap-x-5"> */}
        <div className="grid md:grid-cols-4 lg2:grid-cols-5 items-center gap-5 xl:flex">
          <div className="search_bar flex items-center xl:w-72">
            <TextField.Root
              size={'2'}
              variant="soft"
              color="gray"
              className="w-full"
              placeholder={t('anilist.searchPlaceholder')}
              value={searchTerm.replace(/"/g, '')}
              onChange={(e) => {
                setSearchTerm(`"${e.target.value}"`)
              }}
            >
              <TextField.Slot>
                <MagnifyingGlassIcon height="16" width="16" />
              </TextField.Slot>
            </TextField.Root>
          </div>

          {/* Genre */}
          <div className="flex w-fit">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button variant="ghost" color="gray">
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="flex items-center gap-2 font-inter text-[.8rem] tracking-wider">
                      <MountainsLogo />
                      {genre
                        ? genreLabel(
                            GENRE_KEYS.find((g) => g.toUpperCase() === genre.replace(/"/g, '')) ||
                              genre.replace(/"/g, '')
                          )
                        : t('anilist.genre')}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {GENRE_KEYS.map((v) => (
                  <DropdownMenu.Item key={v} onSelect={() => setGenre(`"${v.toUpperCase()}"`)}>
                    {genreLabel(v)}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setGenre('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {/* Format */}
          <div className="flex w-fit">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button variant="ghost" color="gray">
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="flex items-center gap-2 font-inter text-[.8rem] tracking-wider">
                      {/* TV_SHORT, TV, OVA, MOVIE */}
                      <TVLogo />
                      {format ? formatLabel(format) : t('anilist.format')}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {FORMAT_KEYS.map((v) => (
                  <DropdownMenu.Item key={v} onSelect={() => setFormat(v)}>
                    {formatLabel(v)}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setFormat('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {/* Season */}
          <div className="flex w-fit">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button variant="ghost" color="gray">
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="flex items-center gap-2 font-inter text-[.8rem] tracking-wider">
                      <LeafLogo style="" />

                      {season ? seasonLabel(season) : t('anilist.season')}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {SEASON_KEYS.map((v) => (
                  <DropdownMenu.Item key={v} onSelect={() => setSeason(v)}>
                    {seasonLabel(v)}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setSeason('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {/* YEAR */}
          <div className="flex w-fit items-center">
            <DropdownMenu.Root modal={false}>
              <TextField.Root
                color="gray"
                className="w-20"
                variant="soft"
                placeholder={t('anilist.year')}
                value={year}
                onChange={(e) => {
                  setYear(e.target.value)
                }}
                style={{
                  borderRadius: '4px 0 0 4px'
                }}
              >
                <TextField.Slot></TextField.Slot>
              </TextField.Root>
              <DropdownMenu.Trigger>
                <Button
                  variant="soft"
                  size={'2'}
                  color="gray"
                  style={{
                    borderRadius: '0 4px 4px 0'
                  }}
                >
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="font-inter text-[.8rem] tracking-wider">
                      {/* {year ? year : 'YEAR'} */}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Content>
                {
                  // to current year + 2
                  Array.from({ length: new Date().getFullYear() - 1969 }, (_, i) => i + 1972)
                    .reverse()
                    .map((year) => (
                      <DropdownMenu.Item key={year} onSelect={() => setYear(year)}>
                        {year}
                      </DropdownMenu.Item>
                    ))
                }
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setYear('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {/* STATUS */}
          <div className="flex w-fit">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button variant="ghost" color="gray">
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="flex items-center gap-2 font-inter text-[.8rem] tracking-wider">
                      <CassetteTapeLogo />
                      {status ? statusLabel(status) : t('anilist.status')}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {STATUS_KEYS.map((v) => (
                  <DropdownMenu.Item key={v} onSelect={() => setStatus(v)}>
                    {statusLabel(v)}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setStatus('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {/* SORT */}
          <div className="flex w-fit">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button variant="ghost" color="gray">
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="flex items-center gap-2 font-inter text-[.8rem] tracking-wider">
                      <SortDescLogo />
                      {sort ? sortLabel(sort) : t('anilist.sortBy')}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {SORT_KEYS.map((v) => (
                  <DropdownMenu.Item key={v} onSelect={() => setSort(v)}>
                    {sortLabel(v)}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setSort('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {/* USER STATUS */}
          <div className="flex w-fit">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button
                  variant="outline"
                  color="indigo"
                  size={'1'}
                  style={{
                    padding: '.84rem .55rem'
                  }}
                >
                  <div className="flex animate-fade items-center gap-x-2">
                    <div className="flex items-center gap-2 font-inter text-[.8rem] tracking-wider">
                      {watchStatus ? listStatusLabel(watchStatus) : t('anilist.myStatus')}
                    </div>
                  </div>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {statusMap.map((v) => (
                  <DropdownMenu.Item key={v} onSelect={() => setWatchStatus(v)}>
                    {listStatusLabel(v)}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  shortcut={<TrashIcon />}
                  onSelect={() => setWatchStatus('')}
                >
                  {t('anilist.any')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
        <div className="mx-5">
          <Button
            variant="soft"
            size={'1'}
            onClick={clearAll}
            color={
              genre || season || format || status || sort || year || watchStatus ? 'red' : 'gray'
            }
          >
            <TrashIcon width={'15'} height={'15'} />
          </Button>
        </div>
      </div>

      {infiniteQueryError && (
        <div className="text-red-500">{t('anilist.fetchError', { message: infiniteQueryError.message })}</div>
      )}

      {infiniteQueryError && (
        <div className="mt-10 flex w-full justify-center">
          <ErrorElement error={infiniteQueryError.message} />
        </div>
      )}

      {!infiniteQueryError &&
        !isFetching &&
        anime.length === 0 &&
        searchTerm === title &&
        !working && (
          <div className="mt-10 flex w-full animate-fade justify-center">
            <ErrorElement
              title={t('anilist.notFoundTitle')}
              text={t('anilist.notFoundText')}
              type={'info'}
            />
            {/* <p className="tracking-wider">No anime found !</p> */}
          </div>
        )}

      {!infiniteQueryError && (
        <div className="mt-12">
          <InfiniteScroll
            style={{ all: 'unset' }}
            dataLength={anime.length}
            next={() => fetchNextPage()}
            hasMore={anime?.length < 500}
            // loader={
            //   <div className="flex items-center justify-center gap-x-2 overflow-hidden">
            //     <h4>Loading...</h4>
            //     <Spinner />
            //   </div>
            // }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 lg2:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-9">
              {anime?.map((anime) => {
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

export default Anilist
