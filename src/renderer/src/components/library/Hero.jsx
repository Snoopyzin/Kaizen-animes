import SmartImage from './SmartImage'

// Banner (backdrop) with the poster lifted over it and the details beside the poster, like the
// anime page. Without a backdrop the page just starts lower. Children are the details column.
export default function Hero({ backdrop = '', poster = '', title = '', children }) {
  return (
    <div className="relative font-space-mono">
      {backdrop && (
        <div className="relative">
          <SmartImage
            sources={[backdrop]}
            plain
            eager
            className="h-72 w-full brightness-90 2xl:h-96"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#111113] to-transparent"
          />
        </div>
      )}
      <div
        className={`relative z-10 mx-auto flex items-start gap-x-8 px-6 lg:container ${backdrop ? '' : 'pt-24'}`}
      >
        <SmartImage
          sources={[poster]}
          label={title}
          eager
          className={`aspect-[2/3] w-44 shrink-0 rounded-md shadow-3xl lg:w-60 ${backdrop ? '-mt-28' : ''}`}
        />
        <div className="min-w-0 flex-1 pt-3">{children}</div>
      </div>
    </div>
  )
}
