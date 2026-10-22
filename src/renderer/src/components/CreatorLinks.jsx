import { useEffect, useRef, useState } from 'react'
import { GitHubLogoIcon, InstagramLogoIcon } from '@radix-ui/react-icons'
import { BRAND } from '../brand'
import { t } from '../i18n'

const LINKS = [
  {
    key: 'instagram',
    href: 'https://www.instagram.com/gabriel.arm_/',
    handle: '@gabriel.arm_',
    Icon: InstagramLogoIcon
  },
  { key: 'github', href: 'https://github.com/Snoopyzin', handle: 'Snoopyzin', Icon: GitHubLogoIcon }
]

// Floating round button (bottom-right) that opens the creator's Instagram and GitHub.
export default function CreatorLinks() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-y-2">
      {open && (
        <div className="w-56 animate-fade overflow-hidden rounded-lg border border-gray-700 bg-[#111113]/95 font-space-mono shadow-xl backdrop-blur">
          <p className="border-b border-gray-800 px-3 py-2 text-xs text-gray-400">{t('creator.title')}</p>
          {LINKS.map(({ key, href, handle, Icon }) => (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-x-3 px-3 py-2.5 text-sm text-gray-200 transition-colors hover:bg-purple-500/15 hover:text-white"
            >
              <Icon width={18} height={18} />
              <span className="flex flex-col leading-tight">
                <span>{t(`creator.${key}`)}</span>
                <span className="text-xs text-gray-500">{handle}</span>
              </span>
            </a>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('creator.button')}
        aria-label={t('creator.button')}
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-purple-700 bg-[#111113] text-xl font-bold text-[#9333ea] shadow-lg transition-transform hover:scale-105"
        style={{ fontFamily: '"Yu Gothic UI", "Meiryo UI", "Noto Sans JP", sans-serif' }}
      >
        {BRAND.jp[0]}
      </button>
    </div>
  )
}
