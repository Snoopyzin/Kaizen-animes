import { getLanguage } from './index'

// AniList returns English enums/names. These helpers show them in the interface language and
// fall back to the raw value, so unknown values are never lost.
const pick = (table, value) => {
  if (value === null || value === undefined) return ''
  const entry = table[value]
  if (!entry) return String(value)
  return entry[getLanguage()] ?? entry.en ?? String(value)
}

const GENRES = {
  Action: { pt: 'Ação', en: 'Action' },
  Adventure: { pt: 'Aventura', en: 'Adventure' },
  Comedy: { pt: 'Comédia', en: 'Comedy' },
  Drama: { pt: 'Drama', en: 'Drama' },
  Ecchi: { pt: 'Ecchi', en: 'Ecchi' },
  Fantasy: { pt: 'Fantasia', en: 'Fantasy' },
  Hentai: { pt: 'Hentai', en: 'Hentai' },
  Horror: { pt: 'Terror', en: 'Horror' },
  'Mahou Shoujo': { pt: 'Mahou Shoujo', en: 'Mahou Shoujo' },
  Mecha: { pt: 'Mecha', en: 'Mecha' },
  Music: { pt: 'Música', en: 'Music' },
  Mystery: { pt: 'Mistério', en: 'Mystery' },
  Psychological: { pt: 'Psicológico', en: 'Psychological' },
  Romance: { pt: 'Romance', en: 'Romance' },
  'Sci-Fi': { pt: 'Ficção científica', en: 'Sci-Fi' },
  'Slice of Life': { pt: 'Slice of Life', en: 'Slice of Life' },
  Sports: { pt: 'Esportes', en: 'Sports' },
  Supernatural: { pt: 'Sobrenatural', en: 'Supernatural' },
  Thriller: { pt: 'Suspense', en: 'Thriller' }
}

const STATUSES = {
  FINISHED: { pt: 'Finalizado', en: 'Finished' },
  RELEASING: { pt: 'Em exibição', en: 'Releasing' },
  NOT_YET_RELEASED: { pt: 'Ainda não lançado', en: 'Not yet released' },
  CANCELLED: { pt: 'Cancelado', en: 'Cancelled' },
  HIATUS: { pt: 'Em hiato', en: 'Hiatus' }
}

const SEASONS = {
  WINTER: { pt: 'Inverno', en: 'Winter' },
  SPRING: { pt: 'Primavera', en: 'Spring' },
  SUMMER: { pt: 'Verão', en: 'Summer' },
  FALL: { pt: 'Outono', en: 'Fall' }
}

const FORMATS = {
  TV: { pt: 'TV', en: 'TV' },
  TV_SHORT: { pt: 'TV curta', en: 'TV Short' },
  MOVIE: { pt: 'Filme', en: 'Movie' },
  SPECIAL: { pt: 'Especial', en: 'Special' },
  OVA: { pt: 'OVA', en: 'OVA' },
  ONA: { pt: 'ONA', en: 'ONA' },
  MUSIC: { pt: 'Música', en: 'Music' }
}

const LIST_STATUSES = {
  CURRENT: { pt: 'Assistindo', en: 'Watching' },
  PLANNING: { pt: 'Planejando', en: 'Planning' },
  COMPLETED: { pt: 'Concluído', en: 'Completed' },
  DROPPED: { pt: 'Abandonado', en: 'Dropped' },
  PAUSED: { pt: 'Pausado', en: 'Paused' },
  REPEATING: { pt: 'Revendo', en: 'Rewatching' }
}

export const genreLabel = (v) => pick(GENRES, v)
export const statusLabel = (v) => pick(STATUSES, v)
export const seasonLabel = (v) => pick(SEASONS, v)
export const formatLabel = (v) => pick(FORMATS, v)
export const listStatusLabel = (v) => pick(LIST_STATUSES, v)
