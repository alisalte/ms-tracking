import { useEffect, useState } from 'react';

import {
  MDVR_LIVE_RESOLUTION_EVENT,
  type MdvrLiveResolution,
  loadMdvrLiveResolution,
  saveMdvrLiveResolution,
} from '@/lib/mdvr-live-resolution';

/** Shared live-resolution preference (wall toolbar, tile menu, media settings). */
export function useMdvrLiveResolution(): readonly [
  MdvrLiveResolution,
  (next: MdvrLiveResolution) => void,
] {
  const [value, setValue] = useState<MdvrLiveResolution>(() => loadMdvrLiveResolution());

  useEffect(() => {
    const sync = () => setValue(loadMdvrLiveResolution());
    window.addEventListener(MDVR_LIVE_RESOLUTION_EVENT, sync);
    return () => window.removeEventListener(MDVR_LIVE_RESOLUTION_EVENT, sync);
  }, []);

  const update = (next: MdvrLiveResolution) => {
    saveMdvrLiveResolution(next);
    setValue(next);
  };

  return [value, update] as const;
}
