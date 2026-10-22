// The exact Jellyfin queries the library backend sends (one place, so the golden-sample recorder and the
// mock server in test/library use the same ones). `Fields` is an allow-list on Jellyfin's side: a name
// that is not an ItemFields member is silently ignored, and e.g. Width / Height / ChildCount only come
// back when asked for (verified on Jellyfin 12.2).

const IMAGES = { EnableImageTypes: 'Primary', ImageTypeLimit: 1 }

export const PAGE_SIZE = 500
// most recent played episodes read to find when each series was last watched
export const PLAYED_HISTORY_MAX = 2000

export const INDEX_QUERIES = {
  movies: {
    IncludeItemTypes: 'Movie',
    Recursive: true,
    Fields: 'DateCreated,Genres,Width,Height',
    SortBy: 'SortName',
    ...IMAGES
  },
  series: {
    IncludeItemTypes: 'Series',
    Recursive: true,
    Fields: 'DateCreated,Genres,ChildCount,RecursiveItemCount',
    SortBy: 'SortName',
    ...IMAGES
  },
  // the "Specials" season (index 0) of every series: it is not counted as a season
  specials: {
    IncludeItemTypes: 'Season',
    Recursive: true,
    indexNumber: 0,
    EnableImages: false,
    EnableUserData: false
  },
  resume: { Limit: 40, MediaTypes: 'Video', ...IMAGES },
  nextUp: { Limit: 40, ...IMAGES },
  played: {
    IncludeItemTypes: 'Episode',
    Recursive: true,
    Filters: 'IsPlayed',
    SortBy: 'DatePlayed',
    SortOrder: 'Descending',
    EnableImages: false
  }
}

// one item with its streams (GET /Items?ids=<id>); the same list is used for the series page header
export const ITEM_FIELDS =
  'MediaSources,Overview,Genres,Width,Height,DateCreated,ChildCount,RecursiveItemCount,Path'

export const SERIES_EPISODES_FIELDS = 'Overview'
export const NEIGHBOUR_EPISODES_FIELDS = ''
