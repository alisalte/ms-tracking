/**
 * ReportChart — a polymorphic Recharts wrapper selecting the chart component by
 * the MetricSeries `kind` (area / donut / bar / line). Reuses the FleetActivity
 * / Utilization patterns. Each chart sits in a WidgetCard shell.
 */
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { WidgetCard } from '@/components/dashboard/WidgetCard';
import { status } from '@/theme/palette';
import type { MetricSeries } from '@/types/report.types';

interface ReportChartProps {
  series: MetricSeries;
  loading?: boolean;
}

/** Donut slice colors cycled by index. */
const DONUT_COLORS = [status.green, status.amber, status.slate, status.blue, status.purple];

export function ReportChart({ series, loading = false }: ReportChartProps) {
  const { t } = useTranslation();

  return (
    <WidgetCard titleKey={series.titleKey} loading={loading}>
      <ResponsiveContainer width="100%" height={240}>
        {renderChart(series, t)}
      </ResponsiveContainer>
    </WidgetCard>
  );
}

/** Render the correct Recharts component for the series kind. */
function renderChart(series: MetricSeries, t: (k: string) => string) {
  if (series.kind === 'area' && series.series) {
    return (
      <AreaChart data={series.data as unknown as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke="#33415555" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {series.series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={t(s.labelKey)}
            stackId="1"
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.4}
          />
        ))}
      </AreaChart>
    );
  }

  if (series.kind === 'donut') {
    return (
      <PieChart>
        <Pie
          data={series.data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={85}
          paddingAngle={2}
        >
          {series.data.map((d, i) => (
            <Cell key={`cell-${d.label}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    );
  }

  if (series.kind === 'bar') {
    return (
      <BarChart data={series.data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#33415555" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="value" name={t(series.titleKey)} radius={[4, 4, 0, 0]}>
          {series.data.map((d, i) => (
            <Cell key={`b-${d.label}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    );
  }

  // line
  return (
    <LineChart data={series.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="#33415555" />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
      <Tooltip />
      <Line
        type="monotone"
        dataKey="value"
        name={t(series.titleKey)}
        stroke={status.blue}
        strokeWidth={2}
        dot={{ r: 3 }}
      />
    </LineChart>
  );
}
