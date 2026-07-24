import { get, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { isFinishedRecord, type BuyInCurrency, type RecordEvent, type RecordItem, type RecordStatus } from "@/app/lib/longgrind";
import { deleteProfitRecord, syncFinishedRecordProfit } from "@/app/api/profit/store";

const RECORDS_BLOB_PATHNAME = "data/record.json";
const RECORD_STATUSES: RecordStatus[] = ["进行中", "已结束"];
const BUY_IN_CURRENCIES: BuyInCurrency[] = ["￥", "$"];

export const dynamic = "force-dynamic";

type RecordsSnapshot = {
  records: RecordItem[];
  etag: string | null;
};

type RecordPatch = {
  id: string;
  date?: string;
  status?: RecordStatus;
  endedAt?: string | null;
  updatedAt?: string | null;
  event: Partial<
    Pick<
      RecordEvent,
      | "time"
      | "matchName"
      | "amount"
      | "buyInCount"
      | "tableBb"
      | "bounty"
      | "rank"
      | "fieldSize"
      | "result"
      | "currentResult"
      | "platform"
      | "buyInCurrency"
      | "exchangeRate"
      | "exchangeRateDate"
      | "durationText"
      | "note"
    >
  >;
};

type RecordDelete = {
  id: string;
};

class RecordNotFoundError extends Error {}

function jsonError(error: string, status = 500) {
  return NextResponse.json({ error }, { status });
}

function hasBlobCredentials() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isRecordStatus(value: unknown): value is RecordStatus {
  return RECORD_STATUSES.includes(value as RecordStatus);
}

function isBuyInCurrency(value: unknown): value is BuyInCurrency {
  return BUY_IN_CURRENCIES.includes(value as BuyInCurrency);
}

function inferRecordStatus(event: RecordEvent): RecordStatus {
  return event.result != null || event.durationText === "已结束" ? "已结束" : "进行中";
}

function normalizeRecordEvent(value: unknown): RecordEvent | null {
  if (!isObject(value)) return null;

  const buyInCurrency = value.buyInCurrency === undefined
    ? "$"
    : isBuyInCurrency(value.buyInCurrency)
      ? value.buyInCurrency
      : undefined;
  const exchangeRate = value.exchangeRate === undefined
    ? null
    : isNullableNumber(value.exchangeRate)
      ? value.exchangeRate
      : undefined;
  const exchangeRateDate = value.exchangeRateDate === undefined
    ? null
    : isNullableString(value.exchangeRateDate)
      ? value.exchangeRateDate
      : undefined;

  if (
    typeof value.id === "string" &&
    typeof value.time === "string" &&
    typeof value.matchName === "string" &&
    isFiniteNumber(value.amount) &&
    isFiniteNumber(value.buyInCount) &&
    isFiniteNumber(value.tableBb) &&
    (value.bounty === undefined || isNullableNumber(value.bounty)) &&
    (value.rank === undefined || isNullableNumber(value.rank)) &&
    (value.fieldSize === undefined || isNullableNumber(value.fieldSize)) &&
    isNullableNumber(value.result) &&
    isFiniteNumber(value.currentResult) &&
    typeof value.platform === "string" &&
    buyInCurrency !== undefined &&
    exchangeRate !== undefined &&
    exchangeRateDate !== undefined &&
    isNullableString(value.durationText) &&
    isNullableString(value.note)
  ) {
    return {
      id: value.id,
      time: value.time,
      matchName: value.matchName,
      amount: value.amount,
      buyInCount: value.buyInCount,
      tableBb: value.tableBb,
      bounty: value.bounty === undefined ? null : value.bounty,
      rank: value.rank === undefined ? null : value.rank,
      fieldSize: value.fieldSize === undefined ? null : value.fieldSize,
      result: value.result,
      currentResult: value.currentResult,
      platform: value.platform,
      buyInCurrency,
      exchangeRate,
      exchangeRateDate,
      durationText: value.durationText,
      note: value.note,
    };
  }

  return null;
}

function normalizeRecordItem(value: unknown): RecordItem | null {
  if (!isObject(value)) return null;
  const event = normalizeRecordEvent(value.event);

  if (typeof value.date !== "string" || typeof value.createdAt !== "string" || !event) {
    return null;
  }

  const endedAt = value.endedAt === undefined ? null : isNullableString(value.endedAt) ? value.endedAt : undefined;
  const updatedAt = value.updatedAt === undefined ? null : isNullableString(value.updatedAt) ? value.updatedAt : undefined;
  if (endedAt === undefined || updatedAt === undefined) return null;

  const legacyEventStatus =
    isObject(value.event) && isRecordStatus(value.event.status) ? value.event.status : undefined;
  const status = value.status === undefined
    ? legacyEventStatus ?? (endedAt ? "已结束" : inferRecordStatus(event))
    : value.status;
  if (!isRecordStatus(status)) return null;

  return {
    date: value.date,
    createdAt: value.createdAt,
    endedAt,
    updatedAt,
    status,
    event,
  };
}

function recordsFromJson(value: unknown): RecordItem[] {
  const records = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.records)
      ? value.records
      : null;

  if (!records) {
    throw new Error("Record JSON must be an array.");
  }

  const normalizedRecords = records.map(normalizeRecordItem);

  if (normalizedRecords.some((record) => !record)) {
    throw new Error("Record JSON contains an invalid record.");
  }

  return normalizedRecords as RecordItem[];
}

function nullableNumberField(value: unknown) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isNullableNumber(value)) return { ok: false, value: undefined };
  return { ok: true, value };
}

function finiteNumberField(value: unknown) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isFiniteNumber(value)) return { ok: false, value: undefined };
  return { ok: true, value };
}

function nullableStringField(value: unknown) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isNullableString(value)) return { ok: false, value: undefined };
  return { ok: true, value };
}

function stringField(value: unknown) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, value: undefined };
  return { ok: true, value };
}

function recordDeleteFromJson(value: unknown): RecordDelete | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return { id: value.id };
}

function recordPatchFromJson(value: unknown): RecordPatch | null {
  if (!isObject(value) || typeof value.id !== "string") return null;

  const date = stringField(value.date);
  if (!date.ok) return null;

  const status =
    value.status === undefined ? undefined : isRecordStatus(value.status) ? value.status : null;
  if (status === null) return null;

  const endedAt = nullableStringField(value.endedAt);
  const updatedAt = nullableStringField(value.updatedAt);
  if (!endedAt.ok || !updatedAt.ok) return null;

  const eventValue = value.event === undefined ? {} : value.event;
  if (!isObject(eventValue)) return null;

  const time = stringField(eventValue.time);
  const matchName = stringField(eventValue.matchName);
  const amount = finiteNumberField(eventValue.amount);
  const buyInCount = finiteNumberField(eventValue.buyInCount);
  const tableBb = finiteNumberField(eventValue.tableBb);
  const bounty = nullableNumberField(eventValue.bounty);
  const rank = nullableNumberField(eventValue.rank);
  const fieldSize = nullableNumberField(eventValue.fieldSize);
  const result = nullableNumberField(eventValue.result);
  const currentResult = finiteNumberField(eventValue.currentResult);
  const platform = stringField(eventValue.platform);
  const buyInCurrency = eventValue.buyInCurrency === undefined
    ? { ok: true, value: undefined as BuyInCurrency | undefined }
    : isBuyInCurrency(eventValue.buyInCurrency)
      ? { ok: true, value: eventValue.buyInCurrency }
      : { ok: false, value: undefined };
  const exchangeRate = nullableNumberField(eventValue.exchangeRate);
  const exchangeRateDate = nullableStringField(eventValue.exchangeRateDate);
  const durationText = nullableStringField(eventValue.durationText);
  const note = nullableStringField(eventValue.note);

  if (
    !time.ok ||
    !matchName.ok ||
    !amount.ok ||
    !buyInCount.ok ||
    !tableBb.ok ||
    !bounty.ok ||
    !rank.ok ||
    !fieldSize.ok ||
    !result.ok ||
    !currentResult.ok ||
    !platform.ok ||
    !buyInCurrency.ok ||
    !exchangeRate.ok ||
    !exchangeRateDate.ok ||
    !durationText.ok ||
    !note.ok
  ) {
    return null;
  }

  const event: RecordPatch["event"] = {};
  if (time.value !== undefined) event.time = time.value;
  if (matchName.value !== undefined) event.matchName = matchName.value;
  if (amount.value !== undefined) event.amount = amount.value;
  if (buyInCount.value !== undefined) event.buyInCount = buyInCount.value;
  if (tableBb.value !== undefined) event.tableBb = tableBb.value;
  if (bounty.value !== undefined) event.bounty = bounty.value;
  if (rank.value !== undefined) event.rank = rank.value;
  if (fieldSize.value !== undefined) event.fieldSize = fieldSize.value;
  if (result.value !== undefined) event.result = result.value;
  if (currentResult.value !== undefined) event.currentResult = currentResult.value;
  if (platform.value !== undefined) event.platform = platform.value;
  if (buyInCurrency.value !== undefined) event.buyInCurrency = buyInCurrency.value;
  if (exchangeRate.value !== undefined) event.exchangeRate = exchangeRate.value;
  if (exchangeRateDate.value !== undefined) event.exchangeRateDate = exchangeRateDate.value;
  if (durationText.value !== undefined) event.durationText = durationText.value;
  if (note.value !== undefined) event.note = note.value;

  if (
    date.value === undefined &&
    status === undefined &&
    endedAt.value === undefined &&
    updatedAt.value === undefined &&
    Object.keys(event).length === 0
  ) {
    return null;
  }

  return {
    id: value.id,
    ...(date.value !== undefined ? { date: date.value } : {}),
    ...(status ? { status } : {}),
    ...(endedAt.value !== undefined ? { endedAt: endedAt.value } : {}),
    ...(updatedAt.value !== undefined ? { updatedAt: updatedAt.value } : {}),
    event,
  };
}

async function readRecords(): Promise<RecordsSnapshot> {
  const result = await get(RECORDS_BLOB_PATHNAME, {
    access: "private",
    useCache: false,
  });

  if (!result || result.statusCode !== 200) {
    return { records: [], etag: null };
  }

  const text = await new Response(result.stream).text();
  if (!text.trim()) {
    return { records: [], etag: result.blob.etag };
  }

  return {
    records: recordsFromJson(JSON.parse(text)),
    etag: result.blob.etag,
  };
}

async function writeRecords(records: RecordItem[]) {
  return put(RECORDS_BLOB_PATHNAME, JSON.stringify(records, null, 2), {
    access: "private",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
}

async function appendRecord(record: RecordItem) {
  const snapshot = await readRecords();
  const nextRecords = [
    record,
    ...snapshot.records.filter((item) => item.event.id !== record.event.id),
  ];
  const blob = await writeRecords(nextRecords);
  if (isFinishedRecord(record)) {
    await syncFinishedRecordProfit(record);
  }
  return { records: nextRecords, etag: blob.etag };
}

async function deleteRecord(recordDelete: RecordDelete) {
  const snapshot = await readRecords();
  const deletedRecord = snapshot.records.find((record) => record.event.id === recordDelete.id);
  const nextRecords = snapshot.records.filter((record) => record.event.id !== recordDelete.id);

  if (nextRecords.length === snapshot.records.length) {
    throw new RecordNotFoundError();
  }

  const blob = await writeRecords(nextRecords);
  if (deletedRecord) {
    await deleteProfitRecord(deletedRecord.event.id);
  }
  return { records: nextRecords, etag: blob.etag };
}

async function patchRecord(patch: RecordPatch) {
  const snapshot = await readRecords();
  let didPatch = false;
  let patchedRecord: RecordItem | null = null;
  const nextRecords = snapshot.records.map((record) => {
    if (record.event.id !== patch.id) return record;
    didPatch = true;

    patchedRecord = {
      ...record,
      ...(patch.date !== undefined ? { date: patch.date } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
      ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
      event: {
        ...record.event,
        ...patch.event,
      },
    };

    return patchedRecord;
  });

  if (!didPatch) {
    throw new RecordNotFoundError();
  }

  const blob = await writeRecords(nextRecords);
  if (patchedRecord) {
    await syncFinishedRecordProfit(patchedRecord);
  }
  return { records: nextRecords, etag: blob.etag };
}

export async function GET() {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    return NextResponse.json(await readRecords(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to read records", error);
    return jsonError("Record data is not available", 502);
  }
}

export async function POST(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const body = (await request.json()) as { record?: unknown };
    const record = normalizeRecordItem(body.record);

    if (!record) {
      return jsonError("Invalid record payload", 400);
    }

    return NextResponse.json(await appendRecord(record));
  } catch (error) {
    console.error("Failed to save record", error);
    return jsonError("Unable to save record", 502);
  }
}

export async function PATCH(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const patch = recordPatchFromJson(await request.json());

    if (!patch) {
      return jsonError("Invalid record patch payload", 400);
    }

    return NextResponse.json(await patchRecord(patch));
  } catch (error) {
    if (error instanceof RecordNotFoundError) {
      return jsonError("Record not found", 404);
    }

    console.error("Failed to patch record", error);
    return jsonError("Unable to save record", 502);
  }
}

export async function PUT(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const body = (await request.json()) as unknown;
    const records = recordsFromJson(isObject(body) ? body.records : body);
    const blob = await writeRecords(records);

    return NextResponse.json({ records, etag: blob.etag });
  } catch (error) {
    console.error("Failed to replace records", error);
    return jsonError("Unable to save records", 502);
  }
}

export async function DELETE(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const recordDelete = recordDeleteFromJson(await request.json());

    if (!recordDelete) {
      return jsonError("Invalid record delete payload", 400);
    }

    return NextResponse.json(await deleteRecord(recordDelete));
  } catch (error) {
    if (error instanceof RecordNotFoundError) {
      return jsonError("Record not found", 404);
    }

    console.error("Failed to delete record", error);
    return jsonError("Unable to delete record", 502);
  }
}
