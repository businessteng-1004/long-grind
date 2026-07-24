"use client";

import { useEffect, useMemo, useState } from "react";
import {
  amountText,
  isFinishedRecord,
  recordTimestamp,
  roundMoney,
  signedMoney,
  sortProfitPoints,
  totalRecordBuyIn,
} from "../lib/longgrind";
import type { ProfitPoint, RecordItem } from "../lib/longgrind";

type ChartPoint = {
  label: string;
  value: number;
};

type RecordsApiResponse = {
  records?: RecordItem[];
  error?: string;
};

type ProfitApiResponse = {
  profits?: ProfitPoint[];
  error?: string;
};

type BankrollStatSource = "profit" | "records";

const Y_AXIS_SCALE_CONSTANT = 100;
const MIN_Y_TICK_GAP = 34;

function profitTone(value: number) {
  if (value > 0) return "is-positive";
  if (value < 0) return "is-negative";
  return "is-neutral";
}

function compactMoneyText(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue <= 1000) return signedMoney(value, 2);

  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absoluteValue >= 1000000) {
    const flooredMillions = Math.floor((absoluteValue / 1000000) * 100) / 100;
    return `${prefix}$${amountText(flooredMillions, 2)}M`;
  }

  const flooredThousands = Math.floor((absoluteValue / 1000) * 100) / 100;
  return `${prefix}$${amountText(flooredThousands, 2)}K`;
}

function axisTickMoneyText(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue < 1000) return signedMoney(value, 0);

  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absoluteValue >= 1000000) {
    const millions = Math.floor((absoluteValue / 1000000) * 100) / 100;
    return `${prefix}$${amountText(millions, Number.isInteger(millions) ? 0 : 2)}M`;
  }

  return `${prefix}$${amountText(Math.floor(absoluteValue / 1000), 0)}K`;
}

function percentText(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${amountText(value, 1)}%`;
}

function bankrollScale(value: number) {
  if (value === 0) return 0;
  return Math.sign(value) * Math.log1p(Math.abs(value) / Y_AXIS_SCALE_CONSTANT);
}

function buildYAxisTickCandidates(min: number, max: number) {
  const maxAbs = Math.max(Math.abs(min), Math.abs(max), 1);
  const maxExponent = Math.ceil(Math.log10(maxAbs));
  const tickSet = new Set<number>();

  for (let exponent = 0; exponent <= maxExponent; exponent += 1) {
    const magnitude = 10 ** exponent;
    for (const multiplier of [1, 2, 5]) {
      const tick = multiplier * magnitude;
      if (tick >= min && tick <= max) tickSet.add(tick);
      if (-tick >= min && -tick <= max) tickSet.add(-tick);
    }
  }

  if (!tickSet.size) tickSet.add(0);
  return [...tickSet].sort((a, b) => a - b);
}

function filterYAxisTicks(ticks: number[], yForValue: (value: number) => number) {
  const kept: number[] = [];
  const priorityTicks = [...ticks].sort((a, b) => {
    const aIsLossTick = a < 0;
    const bIsLossTick = b < 0;

    if (aIsLossTick !== bIsLossTick) return aIsLossTick ? -1 : 1;
    return Math.abs(b) - Math.abs(a);
  });

  for (const tick of priorityTicks) {
    const y = yForValue(tick);
    const hasRoom = kept.every((keptTick) => Math.abs(yForValue(keptTick) - y) >= MIN_Y_TICK_GAP);
    if (hasRoom) kept.push(tick);
  }

  return kept.sort((a, b) => a - b);
}

function BankrollLineChart({ series }: { series: ChartPoint[] }) {
  const width = 1120;
  const height = 620;
  const padding = { top: 20, right: 34, bottom: 34, left: 84 };
  const values = series.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const scaledMin = bankrollScale(min);
  const scaledMax = bankrollScale(max);
  const scaledRange = Math.max(scaledMax - scaledMin, 1);
  const scaledPadding = scaledRange * 0.025;
  const chartMin = scaledMin - scaledPadding;
  const chartMax = scaledMax + scaledPadding;
  const range = Math.max(chartMax - chartMin, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xForIndex = (index: number) =>
    padding.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const yForValue = (value: number) => padding.top + ((chartMax - bankrollScale(value)) / range) * plotHeight;
  const points = series.map((point, index) => `${xForIndex(index).toFixed(1)},${yForValue(point.value).toFixed(1)}`).join(" ");
  const yTicks = filterYAxisTicks(buildYAxisTickCandidates(min, max), yForValue);
  const zeroY = yForValue(0);
  const profitZoneHeight = Math.max(0, zeroY - padding.top);
  const lossZoneHeight = Math.max(0, padding.top + plotHeight - zeroY);
  const finalValue = series.at(-1)?.value ?? 0;

  return (
    <svg className="bankroll-line-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`累计战绩折线图，最终值 ${signedMoney(finalValue, 2)}`}>
      <title>累计比赛场数与累计总战绩</title>
      <desc>横轴为截止到当前的总比赛场数，纵轴以零轴为盈亏分界，零轴上方为盈利，下方为亏损。</desc>
      <defs>
        <linearGradient id="bankrollCurveStroke" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--red)" />
          <stop offset="52%" stopColor="var(--blue)" />
          <stop offset="100%" stopColor="var(--green)" />
        </linearGradient>
      </defs>

      <rect className="bankroll-profit-zone" x={padding.left} y={padding.top} width={plotWidth} height={profitZoneHeight} />
      <rect className="bankroll-loss-zone" x={padding.left} y={zeroY} width={plotWidth} height={lossZoneHeight} />

      <g className="bankroll-chart-grid">
        {yTicks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={tick.toFixed(2)} className={`bankroll-y-tick ${profitTone(tick)}`}>
              <line x1={padding.left} x2={padding.left + plotWidth} y1={y} y2={y} />
              <text x={padding.left - 14} y={y + 5} textAnchor="end">{axisTickMoneyText(tick)}</text>
            </g>
          );
        })}
      </g>

      <line className="bankroll-zero-line" x1={padding.left} x2={padding.left + plotWidth} y1={zeroY} y2={zeroY} />
      <polyline className="bankroll-chart-line" points={points} />

      <g className="bankroll-chart-points">
        {series.map((point, index) => {
          const x = xForIndex(index);
          const y = yForValue(point.value);
          const isFinal = index === series.length - 1;
          const pointTone = profitTone(point.value);
          const xLabelStep = Math.max(1, Math.ceil(series.length / 8));
          const shouldShowXLabel = series.length <= 10 || index === 0 || isFinal || index % xLabelStep === 0;
          const shouldShowPointMarker = series.length <= 80 || index === 0 || isFinal || index % xLabelStep === 0;
          const tooltipText = `第 ${point.label} 场 · ${compactMoneyText(point.value)}`;
          const tooltipWidth = 164;
          const tooltipHeight = 34;
          const tooltipX = Math.max(padding.left, Math.min(width - padding.right - tooltipWidth, x - tooltipWidth / 2));
          const tooltipY = y - 48 < padding.top ? y + 18 : y - 48;
          const finalLabelX = Math.min(width - padding.right - 8, x + 18);
          const finalLabelY = y < padding.top + 42 ? y + 34 : y - 16;
          return (
            <g
              key={`${point.label}-${index}`}
              className={`bankroll-chart-node ${pointTone}`}
              tabIndex={0}
              aria-label={`第 ${point.label} 场结束后累计战绩 ${signedMoney(point.value, 2)}`}
            >
              {shouldShowPointMarker ? (
                <>
                  <circle className="bankroll-hit-target" cx={x} cy={y} r={18} />
                  <circle className="bankroll-visible-point" cx={x} cy={y} r={isFinal ? 6 : 4} />
                </>
              ) : null}
              {shouldShowXLabel ? (
                <text className="bankroll-x-label" x={x} y={height - 14} textAnchor="middle">{point.label}</text>
              ) : null}
              {isFinal ? (
                <text className={`bankroll-final-label ${pointTone}`} x={finalLabelX} y={finalLabelY} textAnchor="end">
                  {compactMoneyText(point.value)}
                </text>
              ) : null}
              <g className="bankroll-point-tooltip" transform={`translate(${tooltipX.toFixed(1)} ${tooltipY.toFixed(1)})`}>
                <rect width={tooltipWidth} height={tooltipHeight} rx={6} />
                <text x={tooltipWidth / 2} y={22} textAnchor="middle">{tooltipText}</text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function summarizeProfitPoints(points: ProfitPoint[]) {
  let previousValue = 0;
  let totalNet = 0;
  let profitCount = 0;
  let currentLosingStreak = 0;
  let losingStreak = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const chartSeries: ChartPoint[] = [];

  for (const point of sortProfitPoints(points)) {
    const value = point.value;
    const delta = roundMoney(point.result ?? value - previousValue);

    chartSeries.push({
      label: String(point.matchCount),
      value,
    });

    if (delta > 0) {
      profitCount += 1;
      currentLosingStreak = 0;
    } else if (delta < 0) {
      currentLosingStreak += 1;
      losingStreak = Math.max(losingStreak, currentLosingStreak);
    } else {
      currentLosingStreak = 0;
    }

    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, roundMoney(peak - value));
    totalNet = value;
    previousValue = value;
  }

  return {
    chartSeries,
    totalNet,
    profitCount,
    maxDrawdown,
    losingStreak,
  };
}

function summarizeRecords(records: RecordItem[]) {
  let finishedCount = 0;
  let totalAward = 0;
  let totalNet = 0;
  let largestAward = 0;
  let inMoneyCount = 0;
  let totalBuyIns = 0;
  let highestBuyIn = 0;
  let lowestBuyIn = Number.POSITIVE_INFINITY;
  const losingStreakEntries: Array<{ timestamp: number; netResult: number }> = [];

  for (const record of records) {
    if (!isFinishedRecord(record)) continue;

    const buyIn = totalRecordBuyIn(record);
    const result = record.event.result ?? 0;
    const cashPrize = Math.max(0, roundMoney(result + buyIn));
    const bounty = Math.max(0, record.event.bounty ?? 0);
    const award = roundMoney(cashPrize + bounty);
    const netResult = roundMoney(result + bounty);

    finishedCount += 1;
    totalAward = roundMoney(totalAward + award);
    totalNet = roundMoney(totalNet + netResult);
    largestAward = Math.max(largestAward, award);
    inMoneyCount += record.event.rank != null || cashPrize > 0 ? 1 : 0;
    totalBuyIns = roundMoney(totalBuyIns + buyIn);
    highestBuyIn = Math.max(highestBuyIn, buyIn);
    lowestBuyIn = Math.min(lowestBuyIn, buyIn);
    losingStreakEntries.push({
      timestamp: recordTimestamp(record),
      netResult,
    });
  }

  let currentLosingStreak = 0;
  let losingStreak = 0;

  for (const entry of losingStreakEntries.sort((a, b) => a.timestamp - b.timestamp)) {
    if (entry.netResult < 0) {
      currentLosingStreak += 1;
      losingStreak = Math.max(losingStreak, currentLosingStreak);
    } else {
      currentLosingStreak = 0;
    }
  }

  return {
    finishedCount,
    totalAward,
    totalNet,
    largestAward,
    inMoneyText: `${inMoneyCount}/${finishedCount}`,
    losingStreak,
    totalBuyIns,
    averageBuyIn: finishedCount ? roundMoney(totalBuyIns / finishedCount) : 0,
    highestBuyIn,
    lowestBuyIn: Number.isFinite(lowestBuyIn) ? lowestBuyIn : 0,
  };
}

export default function BankrollPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState("");
  const [profits, setProfits] = useState<ProfitPoint[]>([]);
  const [isProfitLoading, setIsProfitLoading] = useState(true);
  const [profitError, setProfitError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadRecords() {
      try {
        const response = await fetch("/api/records", { cache: "no-store" });
        const data = (await response.json()) as RecordsApiResponse;

        if (!response.ok) {
          throw new Error(data.error || "资金数据读取失败");
        }

        if (!isActive) return;
        setRecords(data.records ?? []);
        setRecordsError("");
      } catch (error) {
        if (!isActive) return;
        setRecords([]);
        setRecordsError(error instanceof Error ? error.message : "资金数据读取失败");
      } finally {
        if (isActive) setIsRecordsLoading(false);
      }
    }

    loadRecords();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadProfit() {
      try {
        const response = await fetch("/api/profit", { cache: "no-store" });
        const data = (await response.json()) as ProfitApiResponse;

        if (!response.ok) {
          throw new Error(data.error || "资金曲线读取失败");
        }

        if (!isActive) return;
        setProfits(data.profits ?? []);
        setProfitError("");
      } catch (error) {
        if (!isActive) return;
        setProfits([]);
        setProfitError(error instanceof Error ? error.message : "资金曲线读取失败");
      } finally {
        if (isActive) setIsProfitLoading(false);
      }
    }

    loadProfit();
    return () => {
      isActive = false;
    };
  }, []);

  const profitSummary = useMemo(() => summarizeProfitPoints(profits), [profits]);
  const recordSummary = useMemo(() => summarizeRecords(records), [records]);
  const chartSeries = profitSummary.chartSeries;
  const bankrollStats = {
    totalNet: profitSummary.totalNet,
    roi: recordSummary.totalBuyIns ? roundMoney((recordSummary.totalNet / recordSummary.totalBuyIns) * 100) : 0,
    largestAward: recordSummary.largestAward,
    inMoneyText: recordSummary.inMoneyText,
    highestBuyIn: recordSummary.highestBuyIn,
    lowestBuyIn: recordSummary.lowestBuyIn,
  };
  const stats: Array<{ title: string; value: string; source: BankrollStatSource; tone?: string }> = [
    { title: "累计净结果", value: compactMoneyText(bankrollStats.totalNet), source: "profit", tone: profitTone(bankrollStats.totalNet) },
    { title: "投资回报比", value: percentText(bankrollStats.roi), source: "records", tone: profitTone(bankrollStats.roi) },
    { title: "最大奖金", value: `$${amountText(bankrollStats.largestAward, 2)}`, source: "records" },
    { title: "进奖金圈", value: bankrollStats.inMoneyText, source: "records" },
    { title: "最高买入", value: `$${amountText(bankrollStats.highestBuyIn, 2)}`, source: "records" },
    { title: "最低买入", value: `$${amountText(bankrollStats.lowestBuyIn, 2)}`, source: "records" },
  ];
  const statValue = (source: BankrollStatSource, value: string) => {
    if (source === "profit") {
      if (isProfitLoading) return "...";
      return profitError ? "--" : value;
    }

    if (isRecordsLoading) return "...";
    return recordsError ? "--" : value;
  };

  return (
    <main className="page-canvas">
      <section className="split-page bankroll-page">
        <div className="bankroll-stats">
          {stats.map((stat) => (
            <article key={stat.title}>
              <span>{stat.title}</span>
              <strong className={stat.tone}>{statValue(stat.source, stat.value)}</strong>
            </article>
          ))}
        </div>

        <article className="bankroll-line-panel">
          {isProfitLoading ? (
            <div className="record-state record-loading bankroll-record-state" role="status" aria-live="polite">
              <i aria-hidden="true" />
              <strong>读取资金曲线中</strong>
              <span>正在同步 profit.json</span>
            </div>
          ) : profitError ? (
            <div className="record-state record-error bankroll-record-state" role="status">
              <strong>资金数据读取失败</strong>
              <span>{profitError}</span>
            </div>
          ) : !chartSeries.length ? (
            <div className="record-state record-empty bankroll-record-state">
              <strong>暂无资金曲线</strong>
              <span>结束比赛后，这里会写入累计战绩折线。</span>
            </div>
          ) : (
            <BankrollLineChart series={chartSeries} />
          )}
        </article>
      </section>
    </main>
  );
}
