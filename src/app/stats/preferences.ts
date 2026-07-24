export type StatsView = "date" | "type" | "stack" | "buyin";

export const statsViews: Array<{ id: StatsView; label: string }> = [
  { id: "date", label: "日期" },
  { id: "type", label: "比赛类型" },
  { id: "stack", label: "开始级别" },
  { id: "buyin", label: "买入档位" },
];

export const statsPageSize = 10;
export const defaultStatsView: StatsView = "date";
export const statsViewStorageKey = "longgrind.stats.activeView";

export function isStatsView(value: string | null | undefined): value is StatsView {
  return statsViews.some((view) => view.id === value);
}
