// "1 temporada" / "2 temporadas": the i18n helper has no plural rules, so singular and plural are
// separate keys picked here (each t() call is a literal, so check:i18n verifies them).
import { t } from '../i18n'

export const seasonsLabel = (count) =>
  count === 1 ? t('library.card.season', { count }) : t('library.card.seasons', { count })

export const episodesLabel = (count) =>
  count === 1 ? t('library.card.episode', { count }) : t('library.card.episodes', { count })

export const moviesLabel = (count) =>
  count === 1 ? t('library.count.movie', { count }) : t('library.count.movies', { count })

export const showsLabel = (count) =>
  count === 1 ? t('library.count.show', { count }) : t('library.count.shows', { count })
