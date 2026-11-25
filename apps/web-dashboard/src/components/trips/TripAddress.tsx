import { useEffect, useRef, useState } from 'react';

import { useReverseGeocode } from '@/api/map.api';

interface TripAddressProps {
  /** The fix to reverse-geocode; absent → the fallback label is shown as is. */
  readonly point?: { lat: number; lng: number };
  /** Shown while loading, when geocoding fails, or when there is no fix. */
  readonly fallback: string;
  /**
   * Only geocode once the element scrolls into view (trip roster rows), so a
   * long list never fires every lookup up front.
   */
  readonly lazy?: boolean;
  readonly className?: string;
}

/**
 * TripAddress — the device's address at a trip boundary (start / end).
 *
 * Reverse-geocodes the fix through the map-engine (`/location/reverse`,
 * Redis-cached server side and query-cached here) and falls back to the
 * coordinate label when no geocoder is configured or the lookup fails —
 * never a fabricated address.
 */
export function TripAddress({ point, fallback, lazy = false, className }: TripAddressProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (visible || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  const active = visible && point !== undefined;
  const reverse = useReverseGeocode(active ? point.lat : null, active ? point.lng : null);
  const address = reverse.data?.formatted;
  const coords = point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : undefined;

  return (
    <span ref={ref} className={className} title={address ? `${address}\n${coords}` : coords}>
      {address ?? fallback}
    </span>
  );
}
