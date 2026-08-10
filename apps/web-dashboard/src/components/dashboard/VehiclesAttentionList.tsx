import { AlertTriangle, Battery, BrainCircuit, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useAttention } from '@/api/fleet.api';
import { status } from '@/theme/palette';
import type { AttentionCategory } from '@/types/fleet.types';

import { WidgetCard } from './WidgetCard';

/** Category → icon + semantic color (§0.2: purple = AI, amber = warning, …). */
const CATEGORY_META: Record<AttentionCategory, { icon: LucideIcon; color: string }> = {
  behavior: { icon: AlertTriangle, color: status.amber },
  maintenance: { icon: Wrench, color: status.red },
  ai: { icon: BrainCircuit, color: status.purple },
  device: { icon: Battery, color: status.slate },
};

/**
 * VehiclesAttentionList — the "what should I look at" ranked list.
 *
 * UI_UX_Design.md §1.4: blends maintenance (DTCs), behavior, AI, and
 * device-health signals into a single prioritized queue. Each row shows a
 * category icon, vehicle label, and a short summary.
 */
export function VehiclesAttentionList() {
  const { t } = useTranslation();
  const { data, isLoading } = useAttention();
  const items = data ?? [];

  return (
    <WidgetCard
      titleKey="dashboard.widgets.attention"
      icon={AlertTriangle}
      loading={isLoading}
      empty={items.length === 0 && !isLoading}
      emptyKey="dashboard.empty.attention"
    >
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {items.map((item) => {
          const meta = CATEGORY_META[item.category];
          const Icon = meta.icon;
          return (
            <li key={item.id}>
              <Link
                to="/vehicles"
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <span
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 4px',
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: `linear-gradient(135deg, ${meta.color}33, ${meta.color}12)`,
                      border: `1px solid ${meta.color}40`,
                      color: meta.color,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: 'var(--mui-palette-text-primary)',
                      }}
                    >
                      {item.vehicleLabel}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.75rem',
                        color: 'var(--mui-palette-text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.summary}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--mui-palette-text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t(`dashboard.attention.${item.category}`)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}
