import { useState } from 'react'
import { t } from '../../i18n'
import useTranslatedText from '../../hooks/useTranslatedText'
import { looksPortuguese, paragraphs, plainText } from '../../library/lib'
import { useLibraryPort } from '../../library/hooks'

// Synopsis of a series / movie. Servers usually hold English metadata: when the interface is in
// Portuguese the text is machine translated (useTranslatedText, cached per paragraph) unless it is
// already Portuguese, and the original is one click away. Rendered as text, never as HTML.
export default function Overview({ text }) {
  const port = useLibraryPort()
  const raw = plainText(text)
  const { translated, loading } = useTranslatedText(raw && !looksPortuguese(raw) ? raw : null, port)
  const [original, setOriginal] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const shown = translated && !original ? translated : raw
  if (!shown) {
    return <p className="text-sm opacity-50">{t('librarySeries.overview.none')}</p>
  }
  const long = shown.length > 420

  return (
    <div>
      <div
        className={`relative flex flex-col gap-y-2 overflow-hidden text-sm leading-relaxed opacity-70 ${
          expanded || !long ? '' : 'max-h-[9.5rem]'
        }`}
      >
        {paragraphs(shown).map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
        {long && !expanded && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#111113] to-transparent"
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs text-purple-400 underline-offset-2 hover:underline"
        >
          {expanded ? t('librarySeries.overview.less') : t('librarySeries.overview.more')}
        </button>
      )}
      {(translated || loading) && (
        <p className="mt-2 text-xs opacity-50">
          {loading
            ? t('librarySeries.overview.translating')
            : original
              ? t('librarySeries.overview.original')
              : t('librarySeries.overview.auto')}{' '}
          {translated && (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setOriginal((value) => !value)}
            >
              {original
                ? t('librarySeries.overview.showTranslation')
                : t('librarySeries.overview.showOriginal')}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
