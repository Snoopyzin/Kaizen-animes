import HTMLReactParser from 'html-react-parser'
import { autop } from '@wordpress/autop'
import useTranslatedText from '../hooks/useTranslatedText'
import { useKaizenContext } from '../utils/ContextProvider'

// Renders an API synopsis (HTML, English): the machine translation when the interface is in
// Portuguese and it is ready, otherwise the original text.
export default function TranslatedDescription({ html }) {
  const { backendPort } = useKaizenContext()
  const { translated } = useTranslatedText(html, backendPort)
  return translated ? HTMLReactParser(autop(translated)) : HTMLReactParser(html)
}
