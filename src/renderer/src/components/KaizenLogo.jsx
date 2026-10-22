import { BRAND } from '../brand'

// "kaizen." in white with the kanji in purple, in the same style the previous logo had
// (dark background, purple kanji overlapping the lower part of the wordmark).
export default function KaizenLogo({ size = 96, className = '' }) {
  return (
    <div
      className={`relative inline-flex select-none flex-col items-center ${className}`}
      style={{ height: size, width: size * 2.6 }}
      aria-label={BRAND.name}
    >
      <span
        className="font-inter font-extrabold leading-none tracking-tight text-white"
        style={{ fontSize: size * 0.62, textShadow: '0 4px 14px rgba(0,0,0,0.55)' }}
      >
        {BRAND.lower}.
      </span>
      <span
        className="absolute left-1/2 -translate-x-1/2 font-bold leading-none text-[#9333ea]"
        style={{
          top: size * 0.4,
          fontSize: size * 0.5,
          fontFamily: '"Yu Gothic UI", "Meiryo UI", "Noto Sans JP", sans-serif',
          textShadow: '0 3px 10px rgba(0,0,0,0.7)'
        }}
      >
        {BRAND.jp}
      </span>
    </div>
  )
}
