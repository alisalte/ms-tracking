import type { ApexOptions } from 'apexcharts';
import type { ReactNode } from 'react';
import Chart from 'react-apexcharts';

type ChartType = NonNullable<
  | 'line'
  | 'area'
  | 'bar'
  | 'pie'
  | 'donut'
  | 'radialBar'
  | 'scatter'
  | 'heatmap'
  | 'radar'
  | 'polarArea'
  | 'treemap'
>;

export function ApexChart({
  type,
  series,
  options,
  height = '100%',
  width = '100%',
}: {
  type: ChartType;
  series: ApexOptions['series'];
  options: ApexOptions;
  height?: string | number;
  width?: string | number;
}) {
  return <Chart type={type} series={series} options={options} height={height} width={width} />;
}

export function ChartPanel({
  title,
  empty,
  emptyLabel,
  className = '',
  children,
}: {
  title: string;
  empty?: boolean;
  emptyLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white p-3 ${className}`}
    >
      <h2 className="shrink-0 text-sm font-semibold text-ink-900">{title}</h2>
      {empty ? (
        <p className="m-auto px-4 text-center text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="relative mt-1 min-h-0 flex-1" dir="ltr">
          <div className="absolute inset-0">{children}</div>
        </div>
      )}
    </section>
  );
}
