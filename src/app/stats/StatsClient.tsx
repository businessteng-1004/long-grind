"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  amountText,
  awardAmount,
  isFinishedRecord,
  isInMoneyRecord,
  netResultAmount,
  recordType,
  recordTypeOrder,
  recordTypes,
  roundMoney,
  signedMoney,
  totalRecordBuyIn,
  type BuyInCurrency,
  type RecordItem,
} from "../lib/longgrind";
import {
  defaultStatsView,
  isStatsView,
  statsPageSize,
  statsViewStorageKey,
  statsViews,
  type StatsView,
} from "./preferences";

type RecordsApiResponse = {
  records?: RecordItem[];
  error?: string;
};

type StatTone = "is-positive" | "is-negative" | "is-neutral";

type GroupSummary = {
  key: string;
  label: string;
  detail: string;
  order: number;
  totalCount: number;
  finishedCount: number;
  inMoneyCount: number;
  totalAward: number;
  totalBuyIn: number;
  totalNet: number;
  earliestStartAt: number | null;
  latestEndAt: number | null;
};

type StackBucket = {
  key: string;
  label: string;
  detail: string;
  order: number;
  minExclusive: number;
  maxInclusive: number;
};

const stackBuckets: StackBucket[] = [
  { key: "stack-deep", label: "100BB+", detail: "开始级别", order: 0, minExclusive: 100, maxInclusive: Number.POSITIVE_INFINITY },
  { key: "stack-100", label: "50BB-100BB", detail: "开始级别", order: 1, minExclusive: 50, maxInclusive: 100 },
  { key: "stack-50", label: "40BB-50BB", detail: "开始级别", order: 2, minExclusive: 40, maxInclusive: 50 },
  { key: "stack-40", label: "30BB-40BB", detail: "开始级别", order: 3, minExclusive: 30, maxInclusive: 40 },
  { key: "stack-30", label: "20BB-30BB", detail: "开始级别", order: 4, minExclusive: 20, maxInclusive: 30 },
  { key: "stack-20", label: "10BB-20BB", detail: "开始级别", order: 5, minExclusive: 10, maxInclusive: 20 },
  { key: "stack-10", label: "≤10BB", detail: "开始级别", order: 6, minExclusive: Number.NEGATIVE_INFINITY, maxInclusive: 10 },
];

let statsViewSnapshot: StatsView | null = null;

function toneForValue(value: number): StatTone {
  if (value > 0) return "is-positive";
  if (value < 0) return "is-negative";
  return "is-neutral";
}

function percentText(value: number, signed = false) {
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${amountText(value, 1)}%`;
}

function roiText(totalNet: number, totalBuyIn: number) {
  return totalBuyIn ? percentText(roundMoney((totalNet / totalBuyIn) * 100), true) : "0.0%";
}

function compactMoneyText(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue <= 1000) return signedMoney(value, 2);

  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absoluteValue >= 1000000) {
    return `${prefix}$${amountText(Math.floor((absoluteValue / 1000000) * 100) / 100, 2)}M`;
  }

  return `${prefix}$${amountText(Math.floor((absoluteValue / 1000) * 100) / 100, 2)}K`;
}

function dateKeyFromDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateLabelFromKey(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}年${month}月${day}日` : value;
}

function recordStartDateKey(record: RecordItem) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return record.date;

  const timestamp = Date.parse(`${record.date}T${record.event.time || "00:00"}`);
  if (Number.isFinite(timestamp)) return dateKeyFromDate(new Date(timestamp));
  return record.date;
}

function recordStartTimestamp(record: RecordItem) {
  const timestamp = Date.parse(record.event.time);
  if (Number.isFinite(timestamp)) return timestamp;

  const fallbackTimestamp = Date.parse(`${record.date}T${record.event.time || "00:00"}`);
  return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : null;
}

function recordEndTimestamp(record: RecordItem) {
  if (!record.endedAt) return null;

  const timestamp = Date.parse(record.endedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function stackBucketForRecord(record: RecordItem) {
  const tableBb = record.event.tableBb;
  const bucket = stackBuckets.find(({ minExclusive, maxInclusive }) =>
    tableBb > minExclusive && tableBb <= maxInclusive,
  );
  return bucket ?? { key: "stack-unknown", label: "未标记", detail: "缺少开始级别", order: 99 };
}

function usdBuyInAmount(record: RecordItem) {
  return Math.max(0, record.event.amount || 0);
}

function recordBuyInCurrency(record: RecordItem): BuyInCurrency {
  return record.event.buyInCurrency ?? "$";
}

function recordUsdCnyRate(record: RecordItem) {
  const rate = record.event.exchangeRate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

function originalBuyInAmount(record: RecordItem) {
  const usdAmount = usdBuyInAmount(record);
  const rate = recordUsdCnyRate(record);
  if (recordBuyInCurrency(record) === "￥" && rate) return roundMoney(usdAmount * rate);
  return roundMoney(usdAmount);
}

function normalizedBuyInAmount(record: RecordItem) {
  const amount = originalBuyInAmount(record);
  if (recordBuyInCurrency(record) === "￥") return Math.round(amount);
  return amount;
}

function hasCents(value: number) {
  return Math.abs(value - Math.round(value)) > 0.005;
}

function buyInAmountLabel(currency: BuyInCurrency, amount: number) {
  return `${currency}${amountText(amount, hasCents(amount) ? 2 : 0)}`;
}

function exactBuyInLabel(record: RecordItem) {
  return buyInAmountLabel(recordBuyInCurrency(record), normalizedBuyInAmount(record));
}

function exactBuyInKey(record: RecordItem) {
  return `buyin-exact-${recordBuyInCurrency(record)}-${normalizedBuyInAmount(record).toFixed(2)}`;
}

function buyInBucketForRecord(record: RecordItem) {
  return {
    key: exactBuyInKey(record),
    label: exactBuyInLabel(record),
    detail: "实际买入",
    order: usdBuyInAmount(record),
  };
}

function summarizeGroups(
  records: RecordItem[],
  groupForRecord: (record: RecordItem) => Pick<GroupSummary, "key" | "label" | "detail" | "order">,
) {
  const summaries = new Map<string, GroupSummary>();

  for (const record of records) {
    const group = groupForRecord(record);
    const summary = summaries.get(group.key) ?? {
      ...group,
      totalCount: 0,
      finishedCount: 0,
      inMoneyCount: 0,
      totalAward: 0,
      totalBuyIn: 0,
      totalNet: 0,
      earliestStartAt: null,
      latestEndAt: null,
    };

    summary.totalCount += 1;

    if (isFinishedRecord(record)) {
      const startTimestamp = recordStartTimestamp(record);
      const endTimestamp = recordEndTimestamp(record);

      summary.finishedCount += 1;
      summary.inMoneyCount += isInMoneyRecord(record) ? 1 : 0;
      summary.totalAward = roundMoney(summary.totalAward + awardAmount(record));
      summary.totalBuyIn = roundMoney(summary.totalBuyIn + totalRecordBuyIn(record));
      summary.totalNet = roundMoney(summary.totalNet + netResultAmount(record));
      summary.earliestStartAt = startTimestamp === null
        ? summary.earliestStartAt
        : Math.min(summary.earliestStartAt ?? startTimestamp, startTimestamp);
      summary.latestEndAt = endTimestamp === null
        ? summary.latestEndAt
        : Math.max(summary.latestEndAt ?? endTimestamp, endTimestamp);
    }

    summaries.set(group.key, summary);
  }

  return [...summaries.values()];
}

function summarizeTypes(records: RecordItem[]) {
  const summaries = new Map<string, GroupSummary>();

  for (const summary of summarizeGroups(records, (record) => {
    const type = recordType(record);
    return {
      key: type,
      label: type,
      detail: "比赛类型",
      order: recordTypeOrder(type),
    };
  })) {
    summaries.set(summary.key, summary);
  }

  for (const type of recordTypes) {
    if (summaries.has(type)) continue;
    summaries.set(type, emptySummary({
      key: type,
      label: type,
      detail: "比赛类型",
      order: recordTypeOrder(type),
    }));
  }

  return [...summaries.values()].sort((a, b) =>
    a.order - b.order ||
    b.finishedCount - a.finishedCount ||
    b.totalCount - a.totalCount ||
    b.totalNet - a.totalNet ||
    a.label.localeCompare(b.label),
  );
}

function emptySummary({
  key,
  label,
  detail,
  order,
}: Pick<GroupSummary, "key" | "label" | "detail" | "order">): GroupSummary {
  return {
    key,
    label,
    detail,
    order,
    totalCount: 0,
    finishedCount: 0,
    inMoneyCount: 0,
    totalAward: 0,
    totalBuyIn: 0,
    totalNet: 0,
    earliestStartAt: null,
    latestEndAt: null,
  };
}

function summarizeDates(records: RecordItem[]) {
  return summarizeGroups(records, (record) => {
    const dateKey = recordStartDateKey(record);
    return {
      key: dateKey,
      label: dateLabelFromKey(dateKey),
      detail: "开始日期",
      order: Number(dateKey.replaceAll("-", "")) || 0,
    };
  }).sort((a, b) => b.order - a.order);
}

function summarizeStacks(records: RecordItem[]) {
  const summaries = new Map<string, GroupSummary>();

  for (const summary of summarizeGroups(records, (record) => stackBucketForRecord(record))) {
    summaries.set(summary.key, summary);
  }

  for (const bucket of stackBuckets) {
    if (summaries.has(bucket.key)) continue;
    summaries.set(bucket.key, emptySummary({
      key: bucket.key,
      label: bucket.label,
      detail: bucket.detail,
      order: bucket.order,
    }));
  }

  return [...summaries.values()].sort((a, b) => a.order - b.order);
}

function summarizeBuyIns(records: RecordItem[]) {
  return summarizeGroups(records, (record) => buyInBucketForRecord(record)).sort((a, b) =>
    b.order - a.order ||
    b.finishedCount - a.finishedCount ||
    b.totalCount - a.totalCount ||
    a.label.localeCompare(b.label),
  );
}

function moneyText(value: number) {
  return `$${amountText(value, 2)}`;
}

function matchDurationText(summary: GroupSummary) {
  if (summary.earliestStartAt === null || summary.latestEndAt === null) return "--";

  const durationMinutes = Math.max(0, Math.round((summary.latestEndAt - summary.earliestStartAt) / 60000));
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return `${hours}小时${minutes}分钟`;
}

function hasFinishedMatches(summary: GroupSummary) {
  return summary.finishedCount > 0;
}

function StatsEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="record-state record-empty stats-empty-state">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function readCookieStatsView() {
  if (typeof document === "undefined") return null;

  const prefix = `${statsViewStorageKey}=`;
  const cookieValue = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);

  if (!cookieValue) return null;

  try {
    const decodedView = decodeURIComponent(cookieValue);
    return isStatsView(decodedView) ? decodedView : null;
  } catch {
    return null;
  }
}

function readStoredStatsView(fallbackView: StatsView | null) {
  if (typeof window === "undefined") return fallbackView;

  const cookieView = readCookieStatsView();
  if (cookieView) {
    statsViewSnapshot = cookieView;
    return cookieView;
  }

  try {
    const storedView = window.localStorage.getItem(statsViewStorageKey);
    if (isStatsView(storedView)) {
      statsViewSnapshot = storedView;
      return storedView;
    }
  } catch {
    return statsViewSnapshot ?? fallbackView ?? defaultStatsView;
  }

  return statsViewSnapshot ?? fallbackView ?? defaultStatsView;
}

function subscribeToStoredStatsView(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === statsViewStorageKey) onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(statsViewStorageKey, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(statsViewStorageKey, onStoreChange);
  };
}

function saveStatsView(view: StatsView) {
  statsViewSnapshot = view;

  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(statsViewStorageKey, view);
  } catch {
    // The cookie keeps the refresh path stable even if localStorage is blocked.
  }

  document.cookie = `${statsViewStorageKey}=${encodeURIComponent(view)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(statsViewStorageKey));
}

type StatsClientProps = {
  initialView: StatsView | null;
};

export default function StatsClient({ initialView }: StatsClientProps) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const activeView = useSyncExternalStore(
    subscribeToStoredStatsView,
    () => readStoredStatsView(initialView),
    () => initialView,
  );
  const [datePage, setDatePage] = useState(1);
  const [buyInPage, setBuyInPage] = useState(1);

  useEffect(() => {
    let isActive = true;

    async function loadStats() {
      setIsLoading(true);
      try {
        const recordsResponse = await fetch("/api/records", { cache: "no-store" });
        const recordsData = (await recordsResponse.json()) as RecordsApiResponse;

        if (!recordsResponse.ok) {
          throw new Error(recordsData.error || "牌局数据读取失败");
        }

        if (!isActive) return;
        setRecords(recordsData.records ?? []);
        setLoadError("");
      } catch (error) {
        if (!isActive) return;
        setRecords([]);
        setLoadError(error instanceof Error ? error.message : "统计数据读取失败");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadStats();
    return () => {
      isActive = false;
    };
  }, []);

  const summary = useMemo(() => {
    return {
      buyInSummaries: summarizeBuyIns(records),
      dateSummaries: summarizeDates(records),
      stackSummaries: summarizeStacks(records),
      typeSummaries: summarizeTypes(records),
    };
  }, [records]);

  const totalDatePages = Math.max(1, Math.ceil(summary.dateSummaries.length / statsPageSize));
  const currentDatePage = Math.min(datePage, totalDatePages);
  const pagedDateSummaries = summary.dateSummaries.slice(
    (currentDatePage - 1) * statsPageSize,
    currentDatePage * statsPageSize,
  );
  const totalBuyInPages = Math.max(1, Math.ceil(summary.buyInSummaries.length / statsPageSize));
  const currentBuyInPage = Math.min(buyInPage, totalBuyInPages);
  const pagedBuyInSummaries = summary.buyInSummaries.slice(
    (currentBuyInPage - 1) * statsPageSize,
    currentBuyInPage * statsPageSize,
  );

  const isViewReady = activeView !== null;
  const resolvedActiveView = activeView ?? defaultStatsView;

  const activeGroupedView = resolvedActiveView === "date"
    ? {
        label: "开始日期",
        rows: pagedDateSummaries,
        emptyTitle: "暂无日期统计",
        emptyDescription: "保存第一场牌局后，这里会按开始日期汇总场次、买入、利润和比赛时长。",
      }
    : resolvedActiveView === "type"
      ? {
          label: "类型",
          rows: summary.typeSummaries,
          emptyTitle: "暂无类型统计",
          emptyDescription: "保存第一场牌局后，这里会按比赛类型汇总表现。",
        }
      : resolvedActiveView === "stack"
        ? {
            label: "开始级别",
            rows: summary.stackSummaries,
            emptyTitle: "暂无级别统计",
            emptyDescription: "保存第一场牌局后，这里会按开始级别汇总表现。",
          }
        : {
            label: "买入档位",
            rows: pagedBuyInSummaries,
            emptyTitle: "暂无买入档位",
            emptyDescription: "记录买入金额后，这里会按每个买入档位汇总场次、总买入、利润和 ROI。",
          };

  const isWideStatsTable = resolvedActiveView === "date" ||
    resolvedActiveView === "type" ||
    resolvedActiveView === "stack" ||
    resolvedActiveView === "buyin";
  const shouldShowMatchDuration = resolvedActiveView === "date";
  const shouldShowPagination = resolvedActiveView === "date" || resolvedActiveView === "buyin";
  const currentStatsPage = resolvedActiveView === "buyin" ? currentBuyInPage : currentDatePage;
  const totalStatsPages = resolvedActiveView === "buyin" ? totalBuyInPages : totalDatePages;
  const paginationLabel = resolvedActiveView === "buyin" ? "买入档位分页" : "日期分页";
  const loadingRows = Array.from({ length: isWideStatsTable ? 7 : 8 }, (_, index) => index);

  return (
    <main className="page-canvas">
      <section className="split-page stats-page">
        <div className="stats-view-switcher" aria-label="统计方式">
          {statsViews.map((view) => (
            <button
              key={view.id}
              className={isViewReady && activeView === view.id ? "active" : undefined}
              type="button"
              onClick={() => saveStatsView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="stats-grid stats-grid-focused">
          <article className="stats-panel stats-type-panel">
            {!isViewReady ? (
              <div className="stats-table is-loading" aria-busy="true">
                {loadingRows.map((row) => (
                  <div className="stats-table-row stats-type-wide-table-row" key={row}>
                    <strong className="stats-loading-bar" aria-hidden="true" />
                    <span className="stats-loading-bar" aria-hidden="true" />
                    <span className="stats-loading-bar" aria-hidden="true" />
                    <span className="stats-loading-bar" aria-hidden="true" />
                    <span className="stats-loading-bar" aria-hidden="true" />
                    <span className="stats-loading-bar" aria-hidden="true" />
                    <span className="stats-loading-bar" aria-hidden="true" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <p>{loadError}</p>
            ) : isLoading || activeGroupedView.rows.length ? (
              isWideStatsTable ? (
                <>
                  <div className={`stats-table ${isLoading ? "is-loading" : ""}`} aria-busy={isLoading}>
                    <div className={`stats-table-row ${shouldShowMatchDuration ? "stats-date-table-row" : "stats-type-wide-table-row"} stats-table-head`}>
                      <span>{activeGroupedView.label}</span>
                      <span>比赛场次</span>
                      <span>进钱圈场次</span>
                      <span>总买入</span>
                      <span>总战绩</span>
                      <span>利润</span>
                      <span>投资回报比</span>
                      {shouldShowMatchDuration ? <span>比赛时间</span> : null}
                    </div>
                    {isLoading
                      ? loadingRows.map((row) => (
                          <div className={`stats-table-row ${shouldShowMatchDuration ? "stats-date-table-row" : "stats-type-wide-table-row"}`} key={row}>
                            <strong className="stats-loading-bar" aria-hidden="true" />
                            <span className="stats-loading-bar" aria-hidden="true" />
                            <span className="stats-loading-bar" aria-hidden="true" />
                            <span className="stats-loading-bar" aria-hidden="true" />
                            <span className="stats-loading-bar" aria-hidden="true" />
                            <span className="stats-loading-bar" aria-hidden="true" />
                            <span className="stats-loading-bar" aria-hidden="true" />
                            {shouldShowMatchDuration ? <span className="stats-loading-bar" aria-hidden="true" /> : null}
                          </div>
                        ))
                      : activeGroupedView.rows.map((row) => (
                          <div className={`stats-table-row ${shouldShowMatchDuration ? "stats-date-table-row" : "stats-type-wide-table-row"}`} key={row.key}>
                            <strong>{row.label}</strong>
                            <span>{hasFinishedMatches(row) ? `${row.finishedCount}场` : "--"}</span>
                            <span>{hasFinishedMatches(row) ? `${row.inMoneyCount}场` : "--"}</span>
                            <span>{hasFinishedMatches(row) ? moneyText(row.totalBuyIn) : "--"}</span>
                            <span>{hasFinishedMatches(row) ? moneyText(row.totalAward) : "--"}</span>
                            <span className={toneForValue(row.totalNet)}>{hasFinishedMatches(row) ? signedMoney(row.totalNet, 2) : "--"}</span>
                            <span className={toneForValue(row.totalNet)}>{hasFinishedMatches(row) ? roiText(row.totalNet, row.totalBuyIn) : "--"}</span>
                            {shouldShowMatchDuration ? <span>{matchDurationText(row)}</span> : null}
                          </div>
                      ))}
                  </div>
                  {shouldShowPagination ? (
                    <nav className="stats-pagination" aria-label={paginationLabel}>
                      <button
                        disabled={currentStatsPage === 1}
                        type="button"
                        onClick={() => {
                          if (resolvedActiveView === "buyin") {
                            setBuyInPage(Math.max(1, currentBuyInPage - 1));
                            return;
                          }

                          setDatePage(Math.max(1, currentDatePage - 1));
                        }}
                      >
                        上一页
                      </button>
                      <span>
                        {currentStatsPage}/{totalStatsPages}
                      </span>
                      <button
                        disabled={currentStatsPage === totalStatsPages}
                        type="button"
                        onClick={() => {
                          if (resolvedActiveView === "buyin") {
                            setBuyInPage(Math.min(totalBuyInPages, currentBuyInPage + 1));
                            return;
                          }

                          setDatePage(Math.min(totalDatePages, currentDatePage + 1));
                        }}
                      >
                        下一页
                      </button>
                    </nav>
                  ) : null}
                </>
              ) : (
                <div className={`stats-table ${isLoading ? "is-loading" : ""}`} aria-busy={isLoading}>
                  <div className="stats-table-row stats-table-head">
                    <span>{activeGroupedView.label}</span>
                    <span>场次</span>
                    <span>净结果</span>
                    <span>投资回报比</span>
                    <span>进钱</span>
                  </div>
                  {isLoading
                    ? loadingRows.map((row) => (
                        <div className="stats-table-row" key={row}>
                          <strong className="stats-loading-bar" aria-hidden="true" />
                          <span className="stats-loading-bar" aria-hidden="true" />
                          <span className="stats-loading-bar" aria-hidden="true" />
                          <span className="stats-loading-bar" aria-hidden="true" />
                          <span className="stats-loading-bar" aria-hidden="true" />
                        </div>
                      ))
                    : activeGroupedView.rows.map((row) => (
                        <div className="stats-table-row" key={row.key}>
                          <strong>{row.label}</strong>
                          <span>{hasFinishedMatches(row) ? `${row.finishedCount}/${row.totalCount}` : "--"}</span>
                          <span className={toneForValue(row.totalNet)}>{hasFinishedMatches(row) ? compactMoneyText(row.totalNet) : "--"}</span>
                          <span className={toneForValue(row.totalNet)}>{hasFinishedMatches(row) ? roiText(row.totalNet, row.totalBuyIn) : "--"}</span>
                          <span>{hasFinishedMatches(row) ? `${row.inMoneyCount}/${row.finishedCount}` : "--"}</span>
                        </div>
                      ))}
                </div>
              )
            ) : (
              <StatsEmptyState
                title={activeGroupedView.emptyTitle}
                description={activeGroupedView.emptyDescription}
              />
            )}
          </article>

        </div>
      </section>
    </main>
  );
}
