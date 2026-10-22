// Kaizen's own AniList API client (anilist.co/settings/developer; redirect URL kaizen://anilistauthcallback).
// The login uses the implicit flow (response_type=token), so the client secret is not needed anywhere.
export const ANILIST_CLIENT_ID = 54609
export const anilistAuthUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`

export async function getAnilistProfile(anilistToken) {
  try {
    if (!localStorage.getItem('anilist_token')) return null

    // Fetch user data from AniList API
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anilistToken}`
      },
      body: JSON.stringify({
        query: `
            query {
              Viewer {
                id
                name
                avatar {
                  large
                }
              }
            }
          `
      })
    })

    if (response.status === 429) {
      throw new Error(
        'Too many requests to the API. You are being rate-limited. Please wait a minute and refresh the page.'
      )
    } else if (!response.ok) {
      // const errorData = await response.json();
      let { errors: errorData } = await response.json()
      errorData = errorData[0]

      throw new Error(`Error ${response.status}: ${response.statusText} - ${errorData.message}`)
    }

    const data = await response.json()
    localStorage.setItem('anilist_id', data.data.Viewer.id)
    localStorage.setItem('anilist_name', data.data.Viewer.name)

    return data.data.Viewer
  } catch (error) {
    console.log('Error in getAnilistProfile: ', error)
    throw new Error(error)
  }
}
