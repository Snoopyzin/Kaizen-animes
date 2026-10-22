export function cleanPath(path) {
  return path.replace(/^"(.*)"$/, '$1')
}

export function validateStreamUrl(url) {
  try {
    const parsed = new URL(url)

    // only allow HTTP
    if (parsed.protocol !== 'http:') return false

    // only allow localhost
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return false
    }

    // the backend serves torrents at /streamfile/:magnet/:episode and the local library at
    // /library/stream/:id (that one needs its secret token in the query string)
    if (!parsed.pathname.startsWith('/streamfile/') && !parsed.pathname.startsWith('/library/stream/')) {
      return false
    }

    return true
  } catch {
    return false
  }
}
