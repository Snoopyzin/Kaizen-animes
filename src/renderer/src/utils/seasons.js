// Long-running anime (One Piece, ...) are ONE entry on AniList, but the episode data (ani.zip, TVDB
// numbering) tells which season - for One Piece, which arc - each episode belongs to. These helpers
// turn that into groups the episode list can be filtered by.

const asSeason = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null // 0 = specials, NaN = unknown
}
export { asSeason }

// episodes: sorted by episode number, each with `season` (positive integer or null/undefined).
// Episodes without a season (typically the newest ones, not in the data yet) take the season of the
// previous episode; leading unknowns take the first known one. Returns the CONTIGUOUS runs of the same
// season as [{ season, start, end, count, from, to }] where start/end are indexes in `episodes` and
// from/to the first/last episode numbers (epNum). Without any season data there is a single group
// with season null.
export function groupEpisodesBySeason(episodes) {
  if (!Array.isArray(episodes) || episodes.length === 0) return []
  const seasons = []
  let last = null
  for (const ep of episodes) {
    const own = asSeason(ep?.season)
    if (own !== null) last = own
    seasons.push(own ?? last)
  }
  const firstKnown = seasons.find((s) => s !== null) ?? null
  for (let i = 0; i < seasons.length && seasons[i] === null; i++) seasons[i] = firstKnown

  const groups = []
  seasons.forEach((season, i) => {
    const current = groups[groups.length - 1]
    if (current && current.season === season) current.end = i
    else groups.push({ season, start: i, end: i })
  })
  return groups.map((g) => ({
    ...g,
    count: g.end - g.start + 1,
    from: episodes[g.start].epNum,
    to: episodes[g.end].epNum
  }))
}
