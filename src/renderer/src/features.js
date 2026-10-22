// Features that are built but not part of the released app yet.
// VITE_KAIZEN_LIBRARY=true at build time includes the Biblioteca (movies & series served by the user's
// own Jellyfin server): its header button and its routes. Without it the app has neither.
export const LIBRARY_ENABLED = import.meta.env?.VITE_KAIZEN_LIBRARY === 'true'
