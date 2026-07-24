export type RecordStatus = "进行中" | "已结束";
export type BuyInCurrency = "$" | "￥";

export type RecordEvent = {
  id: string;
  time: string;
  matchName: string;
  amount: number;
  buyInCount: number;
  tableBb: number;
  bounty: number | null;
  rank: number | null;
  fieldSize: number | null;
  result: number | null;
  currentResult: number;
  platform: string;
  buyInCurrency?: BuyInCurrency;
  exchangeRate?: number | null;
  exchangeRateDate?: string | null;
  durationText: string | null;
  note: string | null;
};

export type RecordItem = {
  date: string;
  createdAt: string;
  endedAt: string | null;
  updatedAt: string | null;
  status: RecordStatus;
  event: RecordEvent;
};

export type ProfitPoint = {
  matchCount: number;
  value: number;
  recordId?: string;
  result?: number;
  endedAt?: string | null;
};

export type ReviewStreetPlayerStack = {
  position: string;
  stack: string;
  isHero?: boolean;
};

export type ReviewStreetBetSize = {
  amountBb: number;
  potBb: number;
  amountChips?: number;
  potChips?: number;
};

export type ReviewStreetAction = {
  action: "fold" | "check" | "call" | "open" | "bet" | "raise" | "jam";
  position: string;
  amountBb?: number;
  amountChips?: number;
  addedBb?: number;
  addedChips?: number;
  committedBb?: number;
  committedChips?: number;
  potBeforeBb?: number;
  potBeforeChips?: number;
  potAfterBb?: number;
  potAfterChips?: number;
  stackBeforeBb?: number;
  stackBeforeChips?: number;
  stackAfterBb?: number;
  stackAfterChips?: number;
  isAllIn?: boolean;
};

export type ReviewPlayerProfile = {
  position: string;
  profile: string;
};

export type ReviewStreet = {
  street: "Preflop" | "Flop" | "Turn" | "River";
  board: string;
  actionLine: string;
  actions?: ReviewStreetAction[];
  betSizes?: ReviewStreetBetSize[];
  potBb?: number;
  playerStacks: ReviewStreetPlayerStack[];
  myThought: string;
  gtoThought: string;
};

export type ReviewHandSpot = {
  id: string;
  heroHand: string;
  heroPosition: string;
  opponentPosition: string;
  opponentProfile: string;
  playerProfiles: ReviewPlayerProfile[];
  effectiveStack: string;
  potType: string;
  potSize: string;
  board: {
    flop: string;
    turn: string;
    river: string;
  };
  issue: string;
  status: "待复盘" | "已标记" | "已吸收";
  evLossBb: number;
  tags: string[];
  streets: ReviewStreet[];
  mistake: string;
  gtoSummary: string;
  takeaway: string;
};

export const navItems = [
  { href: "/records", label: "牌局" },
  { href: "/stats", label: "统计" },
  { href: "/bankroll", label: "资金" },
  { href: "/review", label: "复盘" },
];

const recordTypeConfigs = [
  { label: "每日特别赛" },
  { label: "GG大师赛" },
  { label: "赏金猎人赛", isBounty: true },
  { label: "每日急速赛", aliases: ["急速赛"] },
  { label: "生肖赛" },
  { label: "神秘赏金赛", isBounty: true },
  { label: "卫星赛" },
  { label: "多日赛" },
];

export const recordTypes = recordTypeConfigs.map((type) => type.label);

const bountyRecordTypes = recordTypeConfigs
  .filter((type) => type.isBounty)
  .map((type) => type.label);

export function displayResult(event: RecordEvent) {
  return event.result ?? event.currentResult ?? 0;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function amountText(value: number | string, fraction = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
  }).format(Number(value) || 0);
}

export function signedMoney(value: number, fraction = 0) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}$${amountText(Math.abs(value), fraction)}`;
}

function canonicalRecordType(type: string) {
  const normalizedType = type.trim();
  const config = recordTypeConfigs.find((item) =>
    item.label === normalizedType || item.aliases?.includes(normalizedType),
  );
  return config?.label ?? normalizedType;
}

export function recordTypeOrder(type: string) {
  const canonicalType = canonicalRecordType(type);
  const index = recordTypeConfigs.findIndex((item) => item.label === canonicalType);
  return index === -1 ? recordTypeConfigs.length : index;
}

export function recordType(record: RecordItem) {
  const parts = record.event.matchName.split(" - ");
  return canonicalRecordType(parts[parts.length - 1] || "赛事");
}

export function recordName(record: RecordItem) {
  const parts = record.event.matchName.split(" - ");
  return parts.slice(0, -1).join(" - ") || record.event.matchName;
}

export function isBountyRecordType(type: string) {
  return bountyRecordTypes.includes(canonicalRecordType(type));
}

export function isBountyRecord(record: RecordItem) {
  return isBountyRecordType(recordType(record));
}

export function recordStatus(record: RecordItem) {
  return record.status ?? (record.event.result != null ? "已结束" : "进行中");
}

export function isFinishedRecord(record: RecordItem) {
  return recordStatus(record) === "已结束" && record.event.result != null;
}

export function totalRecordBuyIn(record: RecordItem) {
  return roundMoney(record.event.amount * Math.max(1, record.event.buyInCount || 1));
}

export function cashPrizeAmount(record: RecordItem) {
  if (record.event.result == null) return 0;
  return Math.max(0, roundMoney(record.event.result + totalRecordBuyIn(record)));
}

export function bountyAmount(record: RecordItem) {
  return Math.max(0, record.event.bounty ?? 0);
}

export function awardAmount(record: RecordItem) {
  const bounty = bountyAmount(record);
  if (!isBountyRecord(record)) return cashPrizeAmount(record);

  // Bounty tournaments can return bounty even when the player misses the money.
  if (!isInMoneyRecord(record)) return bounty;
  return roundMoney(cashPrizeAmount(record) + bounty);
}

export function netResultAmount(record: RecordItem) {
  return roundMoney(displayResult(record.event) + bountyAmount(record));
}

export function isInMoneyRecord(record: RecordItem) {
  if (record.event.result == null) return false;
  return record.event.rank != null || cashPrizeAmount(record) > 0;
}

export function recordTimestamp(record: RecordItem) {
  const fallback = `${record.date}T${record.event.time || "00:00"}`;
  const timestamp = Date.parse(record.endedAt ?? record.updatedAt ?? record.createdAt ?? fallback);
  return Number.isFinite(timestamp) ? timestamp : Date.parse(fallback) || 0;
}

function profitPointEndedAtTimestamp(point: ProfitPoint) {
  if (!point.endedAt) return null;
  const timestamp = Date.parse(point.endedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortProfitPoints(points: ProfitPoint[]) {
  return [...points].sort((a, b) => {
    const aTimestamp = profitPointEndedAtTimestamp(a);
    const bTimestamp = profitPointEndedAtTimestamp(b);

    if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) {
      return aTimestamp - bTimestamp;
    }

    if (aTimestamp !== null && bTimestamp === null) return -1;
    if (aTimestamp === null && bTimestamp !== null) return 1;

    return a.matchCount - b.matchCount;
  });
}
