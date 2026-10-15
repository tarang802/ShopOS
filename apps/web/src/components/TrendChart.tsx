import { formatMoney, formatMoneyShort } from '@/lib/format';

/**
 * A plain bar chart in SVG: one bar per day, the tallest scaled to fit.
 *
 * No charting library - this is fourteen bars, and a dependency for that would
 * cost more in download size on a shop's connection than the whole drawing is
 * worth. Each bar carries its figure as a tooltip, and the chart scales to its
 * container, so it works on a phone behind the counter.
 */

export interface TrendPoint {
  /** YYYY-MM-DD. */
  date: string;
  totalPaise: number;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 560;
  const height = 170;
  const padding = { top: 12, right: 8, bottom: 26, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(...points.map((point) => point.totalPaise), 1);
  const step = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(4, step * 0.62);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Sales over the last fourteen days">
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line
          key={fraction}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight * (1 - fraction)}
          y2={padding.top + plotHeight * (1 - fraction)}
          stroke="var(--border)"
          strokeDasharray="2 4"
        />
      ))}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={padding.top + plotHeight}
        y2={padding.top + plotHeight}
        stroke="var(--foreground)"
        strokeWidth={1}
      />

      {points.map((point, index) => {
        const barHeight = (point.totalPaise / max) * plotHeight;
        const x = padding.left + step * index + (step - barWidth) / 2;
        const y = padding.top + plotHeight - barHeight;
        const isToday = index === points.length - 1;
        const day = point.date.slice(8);

        return (
          <g key={point.date}>
            <title>{`${point.date}: ${formatMoney(point.totalPaise)}`}</title>
            <rect
              x={x}
              y={point.totalPaise > 0 ? y : padding.top + plotHeight - 1}
              width={barWidth}
              height={point.totalPaise > 0 ? barHeight : 1}
              fill={isToday ? 'var(--brass)' : 'var(--primary)'}
              stroke="var(--primary)"
              strokeWidth={0.5}
            />
            <text x={x + barWidth / 2} y={height - 9} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
              {day}
            </text>
          </g>
        );
      })}

      <text x={padding.left} y={padding.top - 2} fontSize={10} fill="var(--muted-foreground)">
        {formatMoneyShort(max)}
      </text>
    </svg>
  );
}
