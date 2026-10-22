// Grouping of an anime's episodes into seasons / arcs (utils/seasons.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { asSeason, groupEpisodesBySeason } from '../src/renderer/src/utils/seasons.js'

const eps = (...seasons) => seasons.map((season, i) => ({ epNum: String(i + 1), season }))
const summary = (groups) => groups.map((g) => [g.season, g.start, g.end, g.from, g.to, g.count])

test('asSeason keeps positive integers only', () => {
  assert.equal(asSeason(3), 3)
  assert.equal(asSeason('12'), 12)
  for (const bad of [0, -1, 1.5, NaN, null, undefined, '', 'S1', {}]) assert.equal(asSeason(bad), null, String(bad))
})

test('no episodes -> no groups; no season data -> a single group', () => {
  assert.deepEqual(groupEpisodesBySeason([]), [])
  assert.deepEqual(groupEpisodesBySeason(undefined), [])
  assert.deepEqual(summary(groupEpisodesBySeason(eps(null, null, null))), [[null, 0, 2, '1', '3', 3]])
})

test('a single season is a single group (the UI then shows no selector)', () => {
  assert.equal(groupEpisodesBySeason(eps(2, 2, 2, 2)).length, 1)
})

test('contiguous seasons become groups with their episode range', () => {
  const groups = groupEpisodesBySeason(eps(1, 1, 1, 2, 2, 3))
  assert.deepEqual(summary(groups), [
    [1, 0, 2, '1', '3', 3],
    [2, 3, 4, '4', '5', 2],
    [3, 5, 5, '6', '6', 1]
  ])
})

test('episodes without a season join the previous one; leading unknowns join the first known', () => {
  assert.deepEqual(
    summary(groupEpisodesBySeason(eps(null, null, 1, 1, null, 2, null, null))),
    [
      [1, 0, 4, '1', '5', 5],
      [2, 5, 7, '6', '8', 3]
    ]
  )
})

test('a season that comes back later is a new group (the ranges stay contiguous)', () => {
  assert.deepEqual(
    groupEpisodesBySeason(eps(1, 1, 2, 1)).map((g) => [g.season, g.start, g.end]),
    [
      [1, 0, 1],
      [2, 2, 2],
      [1, 3, 3]
    ]
  )
})

test('string seasons from the API are accepted; specials (0) are treated as unknown', () => {
  const groups = groupEpisodesBySeason([
    { epNum: '1', season: '1' },
    { epNum: '2', season: 0 },
    { epNum: '3', season: '2' }
  ])
  assert.deepEqual(summary(groups), [
    [1, 0, 1, '1', '2', 2],
    [2, 2, 2, '3', '3', 1]
  ])
})

test('every episode belongs to exactly one group, in order', () => {
  const list = eps(1, 1, 2, null, 2, 3, 3, 3, null)
  const groups = groupEpisodesBySeason(list)
  let next = 0
  for (const g of groups) {
    assert.equal(g.start, next)
    assert.equal(g.count, g.end - g.start + 1)
    next = g.end + 1
  }
  assert.equal(next, list.length)
})
