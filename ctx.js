// Shared mutable context — populated by initApp() once auth is ready,
// then read by extracted modules (screensaver, games, window-manager).
// Properties are initially no-ops; real implementations are injected during initApp().
export const ctx = {
    getUser:             () => null,
    unlock:              (_id) => {},
    sparkSound:          (_type, _cat) => {},
    acCache:             null,           // { tracks, images } — album-cover preload cache
    prefetchAlbumCovers: () => Promise.resolve(),
};
