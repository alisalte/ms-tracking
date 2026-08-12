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
 *
 * Tailwind surface; hook + category metadata unchanged.
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
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => {
          const meta = CATEGORY_META[item.category];
          const Icon = meta.icon;
          return (
            <li key={item.id}>
              <Link to="/vehicles" className="block no-underline">
                <span className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
                  <span
                    className="flex size-[30px] shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-800 dark:text-white">
                      {item.vehicleLabel}
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                      {item.summary}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[0.7rem] text-gray-500 dark:text-graydark-600">
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
