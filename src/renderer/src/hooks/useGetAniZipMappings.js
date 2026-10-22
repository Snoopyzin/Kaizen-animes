import { useQuery } from '@tanstack/react-query'
import { getAniZipMappings } from '../utils/helper'

export default function useGetAniZipMappings(id, anidb = false) {
  const { isLoading, data, error, status } = useQuery({
    queryKey: ['cur_anime_anizip', id],
    queryFn: () => {
      if (id) return getAniZipMappings(id, anidb)
      return null
    },
    staleTime: 1000 * 60 * 5, // 5 mins
    // keep the episode list current while the page is open (new episodes of airing anime)
    refetchInterval: 1000 * 60 * 30
  })

  return { isLoading, data, error, status }
}
