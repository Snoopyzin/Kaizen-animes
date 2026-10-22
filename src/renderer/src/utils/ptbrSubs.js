// Release titles rarely say which subtitle languages they carry. Explicit tags are certain,
// "MultiSub" releases (e.g. Erai-raws) usually include a Portuguese (Brazil) track.
const EXPLICIT = /pt[-_ .]?br|portugu[eê]s|brazil|\bpor\b|\[pt\]/i
const MULTISUB = /multi[-_ ]?sub/i

// 2 = explicit PT-BR, 1 = probable (MultiSub), 0 = unknown
export function ptBrLevel(title) {
  if (typeof title !== 'string') return 0
  if (EXPLICIT.test(title)) return 2
  if (MULTISUB.test(title)) return 1
  return 0
}

export function sortBySubsThenSeeders(a, b) {
  return ptBrLevel(b.title) - ptBrLevel(a.title) || b.seeders - a.seeders
}
