import { get, put } from "@vercel/blob";
import {
  isFinishedRecord,
  netResultAmount,
  roundMoney,
  sortProfitPoints,
  type ProfitPoint,
  type RecordItem,
} from "@/app/lib/longgrind";

export const PROFIT_BLOB_PATHNAME = "data/profit.json";

export type ProfitSnapshot = {
  profits: ProfitPoint[];
  etag: string | null;
};

type ProfitReadSnapshot = ProfitSnapshot & {
  shouldSeed: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberFromLabel(value: unknown) {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProfitPoint(value: unknown, index: number): ProfitPoint | null {
  if (isFiniteNumber(value)) {
    return {
      matchCount: index + 1,
      value: roundMoney(value),
    };
  }

  if (!isObject(value) || !isFiniteNumber(value.value)) return null;

  const rawMatchCount = numberFromLabel(value.matchCount) ?? numberFromLabel(value.label) ?? index + 1;
  const matchCount = Math.trunc(rawMatchCount);
  if (matchCount < 1) return null;

  const point: ProfitPoint = {
    matchCount,
    value: roundMoney(value.value),
  };

  if (typeof value.recordId === "string" && value.recordId.trim()) {
    point.recordId = value.recordId;
  }

  if (isFiniteNumber(value.result)) {
    point.result = roundMoney(value.result);
  }

  if (value.endedAt === null || typeof value.endedAt === "string") {
    point.endedAt = value.endedAt;
  }

  return point;
}

function sequentialProfitPoints(points: ProfitPoint[]) {
  return sortProfitPoints(points)
    .map((point, index) => ({
      ...point,
      matchCount: index + 1,
      value: roundMoney(point.value),
      ...(point.result !== undefined ? { result: roundMoney(point.result) } : {}),
    }));
}

function recomputeProfitValues(points: ProfitPoint[]) {
  let running = 0;

  return sequentialProfitPoints(points).map((point) => {
    const value = point.result === undefined ? point.value : roundMoney(running + point.result);
    running = value;
    return {
      ...point,
      value,
    };
  });
}

export function profitsFromJson(value: unknown): ProfitPoint[] {
  const profits = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.profits)
      ? value.profits
      : null;

  if (!profits) {
    throw new Error("Profit JSON must be an array.");
  }

  const normalizedProfits = profits.map(normalizeProfitPoint);

  if (normalizedProfits.some((point) => !point)) {
    throw new Error("Profit JSON contains an invalid point.");
  }

  const points = normalizedProfits as ProfitPoint[];
  return recomputeProfitValues(points);
}

export async function readProfit(): Promise<ProfitReadSnapshot> {
  const result = await get(PROFIT_BLOB_PATHNAME, {
    access: "private",
    useCache: false,
  });

  if (!result || result.statusCode !== 200) {
    return { profits: [], etag: null, shouldSeed: true };
  }

  const text = await new Response(result.stream).text();
  if (!text.trim()) {
    return { profits: [], etag: result.blob.etag, shouldSeed: true };
  }

  return {
    profits: profitsFromJson(JSON.parse(text)),
    etag: result.blob.etag,
    shouldSeed: false,
  };
}

export async function writeProfit(profits: ProfitPoint[]) {
  const nextProfits = recomputeProfitValues(profits);

  return put(PROFIT_BLOB_PATHNAME, JSON.stringify(nextProfits, null, 2), {
    access: "private",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
}

export async function ensureProfit(): Promise<ProfitSnapshot> {
  const snapshot = await readProfit();
  if (!snapshot.shouldSeed) {
    return { profits: snapshot.profits, etag: snapshot.etag };
  }

  const blob = await writeProfit(snapshot.profits);
  return { profits: snapshot.profits, etag: blob.etag };
}

export function upsertFinishedRecordProfitPoint(profits: ProfitPoint[], record: RecordItem) {
  const result = netResultAmount(record);
  const endedAt = record.endedAt ?? record.updatedAt ?? null;
  let didUpdate = false;

  const nextProfits = sequentialProfitPoints(profits).map((point) => {
    if (point.recordId !== record.event.id) return point;
    didUpdate = true;
    return {
      ...point,
      result,
      endedAt,
    };
  });

  if (!didUpdate) {
    const previousValue = nextProfits.at(-1)?.value ?? 0;
    nextProfits.push({
      matchCount: nextProfits.length + 1,
      value: roundMoney(previousValue + result),
      recordId: record.event.id,
      result,
      endedAt,
    });
  }

  return recomputeProfitValues(nextProfits);
}

export async function syncFinishedRecordProfit(record: RecordItem) {
  if (!isFinishedRecord(record)) {
    return deleteProfitRecord(record.event.id);
  }

  const snapshot = await readProfit();
  const profits = upsertFinishedRecordProfitPoint(snapshot.profits, record);
  const blob = await writeProfit(profits);

  return { profits, etag: blob.etag };
}

export async function deleteProfitRecord(recordId: string) {
  const snapshot = await readProfit();

  if (!snapshot.profits.some((point) => point.recordId === recordId)) {
    return snapshot;
  }

  const profits = recomputeProfitValues(snapshot.profits.filter((point) => point.recordId !== recordId));
  const blob = await writeProfit(profits);

  return { profits, etag: blob.etag };
}
