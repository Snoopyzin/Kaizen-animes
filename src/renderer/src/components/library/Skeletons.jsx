import { t } from '../../i18n'

const block = 'animate-pulse rounded-sm bg-[#1f1f23]'

// Screen-reader text for a whole skeleton screen
function Busy({ children, className = '' }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{t('library.loading')}</span>
      {children}
    </div>
  )
}

export function PosterSkeleton() {
  return (
    <div aria-hidden="true">
      <div className={`${block} aspect-[2/3] w-full rounded-md`} />
      <div className={`${block} mt-3 h-3 w-4/5`} />
      <div className={`${block} mt-2 h-3 w-1/2`} />
    </div>
  )
}

export function PosterGridSkeleton({ count = 12 }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-8">
      {Array.from({ length: count }, (_, i) => (
        <PosterSkeleton key={i} />
      ))}
    </div>
  )
}

export function RowSkeleton({ count = 4 }) {
  return (
    <div aria-hidden="true" className="flex gap-x-4 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-64 shrink-0">
          <div className={`${block} aspect-video w-full rounded-md`} />
          <div className={`${block} mt-3 h-3 w-3/4`} />
          <div className={`${block} mt-2 h-3 w-1/2`} />
        </div>
      ))}
    </div>
  )
}

export function LibraryPageSkeleton() {
  return (
    <Busy className="px-8 pb-24 pt-24 font-space-mono">
      <div className="mb-6 flex items-center justify-between">
        <div className={`${block} h-7 w-48`} />
        <div className={`${block} h-8 w-72`} />
      </div>
      <div className={`${block} mb-8 h-9 w-full max-w-3xl`} />
      <RowSkeleton />
      <div className="mt-10">
        <PosterGridSkeleton />
      </div>
    </Busy>
  )
}

export function SeriesPageSkeleton() {
  return (
    <Busy className="font-space-mono">
      <div className={`${block} h-72 w-full rounded-none 2xl:h-96`} />
      <div className="mx-auto -mt-28 flex gap-x-8 px-6 lg:container">
        <div className={`${block} aspect-[2/3] w-52 shrink-0 rounded-md lg:w-64`} />
        <div className="mt-32 flex-1">
          <div className={`${block} h-7 w-1/2`} />
          <div className={`${block} mt-4 h-4 w-2/3`} />
          <div className={`${block} mt-6 h-20 w-full`} />
        </div>
      </div>
      <div className="mx-auto mt-10 flex flex-col gap-y-3 px-6 lg:container">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${block} h-28 w-full`} />
        ))}
      </div>
    </Busy>
  )
}

export function PlayerSkeleton() {
  return (
    <Busy className="px-6 pb-24 pt-24 font-space-mono">
      <div className="mx-auto w-full max-w-5xl">
        <div className={`${block} aspect-video w-full rounded-md`} />
        <div className={`${block} mt-6 h-6 w-1/2`} />
        <div className={`${block} mt-3 h-4 w-1/3`} />
      </div>
    </Busy>
  )
}
