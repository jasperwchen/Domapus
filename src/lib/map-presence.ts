import { createContext, useContext } from "react";

/**
 * After its first visit the map stays mounted behind the other app pages, so going back to it
 * is instant instead of a full reload. `alive`: a client-side Map link will find it mounted.
 * `visible`: false while it sits hidden behind another page, when it must not write the URL,
 * hold a dialog open or answer keys. The defaults describe a map rendered on its own.
 */
export const MapPresence = createContext({ alive: false, visible: true });

export const useMapPresence = () => useContext(MapPresence);
