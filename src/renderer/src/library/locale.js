// The BCP-47 tag Intl needs for the language the interface is in (pt = Brazilian Portuguese).
import { getLanguage } from '../i18n'

export const uiLocale = () => (getLanguage() === 'en' ? 'en-US' : 'pt-BR')
