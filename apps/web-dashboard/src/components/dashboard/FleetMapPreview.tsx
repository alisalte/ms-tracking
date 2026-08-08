import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { MapPin } from 'lucide-react';
import { Map as MaplibreMap, Marker as MaplibreMarker, Popup as MaplibrePopup } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMapVehicles } from '@/api/fleet.api';
import { markerDataUrl, vehicleColor } from '@/lib/map-markers';
import { mapAccents } from '@/theme/palette';

import { WidgetCard } from './WidgetCard';

/**
 * FleetMapPreview — a compact MapLibre GL mini-map for the dashboard.
 *
 * UI_UX_Design.md §1.4 / §1.3: a small live map with vehicle markers colored
 * by status (cyan=active, yellow=idle, rose=overspeed, slate=offline). It will
 * connect to the full Map dashboard (Sprint Map) when that lands; for now it is
 * a preview with free OSM tiles.
 *
 * Uses free OpenStreetMap raster tiles — no API key required, matches the
 * "maplibre-gl + free OSM tiles" decision in the FE-3 plan.
 */
export function FleetMapPreview() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<MaplibreMarker[]>([]);
  const { data, isLoading } = useMapVehicles();
  const vehicles = data ?? [];

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [51.338, 35.719],
      zoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers when vehicles arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || vehicles.length === 0) return;

    const apply = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = vehicles.map((v) => {
        const el = document.createElement('img');
        el.src = markerDataUrl(vehicleColor(v));
        el.alt = v.label;
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.cursor = 'pointer';
        const marker = new MaplibreMarker({ element: el, anchor: 'center' })
          .setLngLat([v.lng, v.lat])
          .setPopup(new MaplibrePopup({ offset: 12 }).setHTML(`<b>${v.label}</b><br/>${v.state}`));
        marker.addTo(map);
        return marker;
      });
    };

    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [vehicles]);

  return (
    <WidgetCard
      titleKey="dashboard.widgets.mapPreview"
      icon={MapPin}
      loading={isLoading}
      action={
        <Link
          to="/map"
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            textDecoration: 'none',
            color: 'var(--mui-palette-primary-main)',
          }}
        >
          {t('dashboard.widgets.openMap')} →
        </Link>
      }
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: 220,
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
        {/* Legend overlay (§0.7: never rely on color alone — pair with label). */}
        <Stack
          direction="row"
          gap={1.5}
          sx={{
            position: 'absolute',
            bottom: 6,
            start: 6,
            backgroundColor: 'rgba(255,255,255,0.85)',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            backdropFilter: 'blur(4px)',
          }}
        >
          {(
            [
              ['active', mapAccents.vehicleActive],
              ['idle', mapAccents.vehicleIdle],
              ['overspeed', mapAccents.vehicleOverspeed],
              ['offline', mapAccents.vehicleOffline],
            ] as const
          ).map(([key, color]) => (
            <Stack key={key} direction="row" alignItems="center" gap={0.25}>
              <Box
                component="span"
                sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }}
              />
              <Typography variant="caption" color="text.secondary">
                {t(`dashboard.map.${key}`)}
              </Typography>
            </Stack>
          ))}
        </Stack>
        {isLoading && <Skeleton variant="rectangular" sx={{ position: 'absolute', inset: 0 }} />}
      </Box>
    </WidgetCard>
  );
}
