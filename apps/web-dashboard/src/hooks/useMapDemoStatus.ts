import { useCallback, useEffect, useState } from 'react';

import {
  MAP_DEMO_STATUS_CHANGE_EVENT,
  MAP_DEMO_STATUS_STORAGE_KEY,
  loadPersistedMapDemoStatus,
  persistMapDemoStatus,
} from '@/lib/map-demo-status';

/** Demo status colors on the live map — persisted per browser. */
export function useMapDemoStatus(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadPersistedMapDemoStatus);

  useEffect(() => {
    const onCustom = (event: Event) => {
      setOn(Boolean((event as CustomEvent<boolean>).detail));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAP_DEMO_STATUS_STORAGE_KEY) return;
      if (event.newValue === '0' || event.newValue === 'false') setOn(false);
      else if (event.newValue === '1' || event.newValue === 'true') setOn(true);
    };
    window.addEventListener(MAP_DEMO_STATUS_CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MAP_DEMO_STATUS_CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const change = useCallback((next: boolean) => {
    setOn(next);
    persistMapDemoStatus(next);
  }, []);

  return [on, change];
}
