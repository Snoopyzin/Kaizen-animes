import * as Comlink from 'comlink'
import { GET_TOSHO_RSS, GET_TOSHO_RSS_BY_QUERY } from '../utils/api'

// Local replacement for the remote `gh/hitarth-gg/mizukijs` extension, which hardcodes the
// defunct feed.animetosho.org domain. The URL builders in api.js use the current domain.
async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)
  return await response.json()
}

const toshoExtension = {
  getToshoEpisodes: async ({ quality, aids, eids }) => {
    try {
      return await fetchJson(GET_TOSHO_RSS_BY_QUERY(quality, aids, eids))
    } catch (error) {
      console.error('Error fetching episodes:', error)
      throw error
    }
  },
  getNewReleases: async (packer) => {
    try {
      return await fetchJson(GET_TOSHO_RSS(packer))
    } catch (error) {
      console.error('Error fetching new releases:', error)
      throw error
    }
  }
}

Comlink.expose(toshoExtension)
console.log('Worker initialized')
