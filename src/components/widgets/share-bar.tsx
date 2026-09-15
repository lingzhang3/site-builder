"use client";

import { useState } from "react";

import type { QueryResult } from "@/lib/connectors/types";
import { formatNumber, formatValue } from "@/lib/widgets/format";
import { TransformError, transformForShare, type ShareSegment } from "@/lib/widgets/transform";
import type { WidgetConfig } from "@/lib/widgets/types";
import { ChartLegend } from "./chart-parts";
import { WidgetEmpty, WidgetError } from "./chart-shell";

/**
 * Part-to-whole as a horizontal 100% stacked bar, which is the form the
 * data-viz method prescribes for this job. A pie or donut is deliberately not
 * offered: readers cannot compare close slices by angle, and a pie's segments
 * are all mutually adjacent, so the palette only stays colorblind-safe for
 * three of them.
 *
 * Built by hand rather than with Recharts so the 2px surface gaps between
 * segments are exact, and so the labels live in the legend rather than on the
 * fills — every segment here is an interior one with no free end, and text on
 * the fill cannot clear contrast across the whole palette.
 */
export function ShareBar({
  result,
  config,
}: {
  result: QueryResult;
  config: WidgetConfig;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  let data;
  try {
    data = transformForShare(result, config);
  } catch (error) {
    return (
      <WidgetError
        message={error instanceof TransformError ? error.message : "Could not read the data."}
      />
    );
  }

  if (data.segments.length === 0 || data.total === 0) return <WidgetEmpty />;

  return (
    <div className="flex h-full flex-col justify-center gap-3 px-1">
      <div
        className="flex h-9 w-full gap-[2px]"
        role="img"
        aria-label={data.segments
          .map(
            (segment) =>
              `${segment.label}: ${formatNumber(segment.percent, { style: "percent", decimals: 0 })}`,
          )
          .join(", ")}
        onPointerLeave={() => setHovered(null)}
      >
        {data.segments.map((segment, index) => (
          <Segment
            key={segment.label}
            segment={segment}
            anyHovered={hovered !== null}
            isHovered={hovered === segment.label}
            onHover={setHovered}
            format={config.format}
            isFirst={index === 0}
            isLast={index === data.segments.length - 1}
          />
        ))}
      </div>

      {/* The legend is the identity channel and, here, the value channel too. */}
      <ChartLegend
        markShape="rect"
        entries={data.segments.map((segment) => ({
          name: segment.label,
          color: segment.color,
          value: formatNumber(segment.percent, { style: "percent", decimals: 0 }),
        }))}
      />

      <p className="px-1 text-[11px] text-ink-subtle">
        Total {formatValue(data.total, config.format)}
        {data.folded ? " · smallest categories grouped as Other" : ""}
      </p>
    </div>
  );
}

function Segment({
  segment,
  anyHovered,
  isHovered,
  onHover,
  format,
  isFirst,
  isLast,
}: {
  segment: ShareSegment;
  anyHovered: boolean;
  isHovered: boolean;
  onHover: (label: string | null) => void;
  format: WidgetConfig["format"];
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div
      onPointerEnter={() => onHover(segment.label)}
      onFocus={() => onHover(segment.label)}
      onBlur={() => onHover(null)}
      tabIndex={0}
      // The hover/focus readout: every value the chart shows is reachable here
      // and in the table view, so nothing is gated behind pointing at a mark.
      title={`${segment.label}: ${formatValue(segment.value, format)} (${formatNumber(
        segment.percent,
        { style: "percent", decimals: 1 },
      )})`}
      style={{ width: `${segment.percent}%`, backgroundColor: segment.color }}
      className={[
        "min-w-[3px] transition-opacity",
        isFirst ? "rounded-l-md" : "",
        isLast ? "rounded-r-md" : "",
        // The hovered segment stays full strength while the others recede, so
        // the reader can see which one they are reading.
        anyHovered && !isHovered ? "opacity-40" : "opacity-100",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
