import { t } from '../../i18n'

let BASE_URL = 'http://localhost:64621/animepahe'

// The backend answers with English messages; show them in the interface language.
const KNOWN_ERRORS = {
  'Please use webview to enter the website then close the webview window.': 'animePahe.useWebview',
  'Could not read cookies or base URL.': 'animePahe.noCookies'
}
const localize = (json) => {
  const key = json && typeof json.error === 'string' ? KNOWN_ERRORS[json.error] : null
  return key ? { ...json, error: t(key) } : json
}

async function backendPort() {
  const response = await window.api.getSettingsJson()
  const backendPort = response.backendPort
  BASE_URL = `http://localhost:${backendPort}/animepahe`
}

backendPort()

export const animepaheLatest = async (page = 1) => {
  const response = await fetch(`${BASE_URL}/latest?page=${page}`)
  return localize(await response.json())
}
export const animepaheDetails = async (page = 1) => {
  const response = await fetch(`${BASE_URL}/details?id=${page}`)
  return localize(await response.json())
}

export const animepaheEpisodes = async (id, page = 1) => {
  const response = await fetch(`${BASE_URL}/getallepisodes?id=${id}`)
  const data = await response.json()
  return { data: data.episodes }
}
export const animepaheEpisodesOfPage = async (id, page = 1) => {
  const response = await fetch(`${BASE_URL}/getepisodesofpage?id=${id}&page=${page}`)
  const data = await response.json()
  return { data: data.episodes }
}

export const animepahePlay = async (id, episode) => {
  const response = await fetch(`${BASE_URL}/play?id=${id}&episode=${episode}`)
  return localize(await response.json())
}

export const animepaheSearch = async (query) => {
  const response = await fetch(`${BASE_URL}/search?q=${query}`)
  return localize(await response.json())
}
