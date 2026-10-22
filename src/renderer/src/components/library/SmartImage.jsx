import { useState } from 'react'
import { ImageIcon } from '@radix-ui/react-icons'

// An image that never looks broken: a pulsing block while it loads, the next candidate when one
// fails (an episode without its own still falls back to the series art), and a placeholder card
// when there is nothing to show (`plain`: just a dark block, for backdrops). The box (size, ratio, rounding) is given by `className`.
export default function SmartImage({
  sources = [],
  className = '',
  label = '',
  eager = false,
  plain = false
}) {
  const list = (Array.isArray(sources) ? sources : []).filter(Boolean)
  const signature = list.join('|')
  const [state, setState] = useState({ signature, index: 0, loaded: false })

  let current = state
  if (state.signature !== signature) {
    // another set of images (the card is reused for a different item): start over
    current = { signature, index: 0, loaded: false }
    setState(current)
  }
  const src = list[current.index]

  return (
    <div className={`relative overflow-hidden bg-[#1a1a1d] ${className}`}>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className={`h-full w-full object-cover transition-opacity duration-300 ${current.loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setState((prev) => ({ ...prev, loaded: true }))}
          onError={() => setState((prev) => ({ ...prev, index: prev.index + 1, loaded: false }))}
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full flex-col items-center justify-center gap-y-2 bg-gradient-to-br from-[#26262b] to-[#17171a] p-3 text-center text-gray-500"
        >
          {!plain && <ImageIcon width={22} height={22} />}
          {!plain && label && <span className="line-clamp-3 text-xs opacity-70">{label}</span>}
        </div>
      )}
      {src && !current.loaded && (
        <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-[#232327]" />
      )}
    </div>
  )
}
