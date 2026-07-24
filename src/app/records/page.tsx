"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type UIEvent } from "react";
import {
  type BuyInCurrency,
  displayResult,
  isBountyRecord,
  isBountyRecordType,
  recordName,
  recordStatus,
  recordType,
  recordTypes,
  signedMoney,
  type RecordEvent,
  type RecordItem,
} from "../lib/longgrind";

const RECORDS_PER_PAGE = 10;
const WEEKDAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const CALENDAR_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const BUY_IN_CURRENCIES: BuyInCurrency[] = ["￥", "$"];
const TIME_OPTIONS = Array.from({ length: 1440 }, (_, index) => {
  const hours = String(Math.floor(index / 60)).padStart(2, "0");
  const minutes = String(index % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
});
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"));
const SETTLEMENT_TIME_OPTIONS = TIME_OPTIONS;

type Draft = {
  name: string;
  type: string;
  date: string;
  time: string;
  amount: string;
  buyInCount: string;
  tableBb: string;
  buyInCurrency: BuyInCurrency;
  result: string;
  note: string;
};

type MoneyBubbleStatus = "是" | "否";
type TimePart = "hour" | "minute";

const MONEY_STATUS_OPTIONS: MoneyBubbleStatus[] = ["否", "是"];

type SettlementDraft = {
  result: string;
  bounty: string;
  rank: string;
  fieldSize: string;
  inMoney: MoneyBubbleStatus;
  endDate: string;
  endTime: string;
};

type RequiredDraftField = "name" | "amount" | "tableBb";

type RecordsApiResponse = {
  records?: RecordItem[];
  etag?: string | null;
  error?: string;
};

const RECORDS_SNAPSHOT_DEDUPE_MS = 1000;

let recordsSnapshotRequest: Promise<RecordsApiResponse> | null = null;
let recordsSnapshotCache: { data: RecordsApiResponse; updatedAt: number } | null = null;

function requestRecordsSnapshot() {
  if (recordsSnapshotCache && Date.now() - recordsSnapshotCache.updatedAt < RECORDS_SNAPSHOT_DEDUPE_MS) {
    return Promise.resolve(recordsSnapshotCache.data);
  }

  recordsSnapshotRequest ??= fetch("/api/records", { cache: "no-store" })
    .then(async (response) => {
      const data = (await response.json()) as RecordsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "无法读取记录");
      }

      recordsSnapshotCache = {
        data,
        updatedAt: Date.now(),
      };
      return data;
    })
    .finally(() => {
      recordsSnapshotRequest = null;
    });

  return recordsSnapshotRequest;
}

type ExchangeRateApiResponse = {
  rate?: number;
  date?: string | null;
  base?: string;
  quote?: string;
  error?: string;
};

type RecordPatchPayload = {
  id: string;
  date?: string;
  status?: RecordItem["status"];
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

type RecordListStatus = RecordItem["status"] | "未开始";

type ConfirmationDialog = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger" | "finish";
  onConfirm: () => Promise<void> | void;
};

type RecordDeleteMode = "cancel" | "delete";

const requiredDraftFields: RequiredDraftField[] = ["name", "amount", "tableBb"];
const requiredFieldNames: Record<RequiredDraftField, string> = {
  name: "比赛名称",
  amount: "买入",
  tableBb: "当前级别",
};

function nextMinuteDate(date: Date) {
  const nextDate = new Date(date);
  if (nextDate.getSeconds() > 0 || nextDate.getMilliseconds() > 0) {
    nextDate.setMinutes(nextDate.getMinutes() + 1);
  }
  nextDate.setSeconds(0, 0);
  return nextDate;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeKey(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timezoneOffsetText(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function localTimestamp(date: Date) {
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${dateKey(date)}T${timeKey(date)}:${seconds}.${milliseconds}${timezoneOffsetText(date)}`;
}

function dateFromDateTimeKeys(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (
    !year ||
    !month ||
    !day ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return new Date();
  }

  const date = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateFromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function monthStartFromDateKey(value: string) {
  const date = dateFromDateKey(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthTitle(date: Date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}

function calendarDays(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + index);
    return {
      key: dateKey(currentDate),
      label: String(currentDate.getDate()),
      isCurrentMonth: currentDate.getMonth() === month,
    };
  });
}

function nearestTimeOption(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return TIME_OPTIONS[0];
  const safeHour = Math.max(0, Math.min(23, Math.trunc(hour)));
  const safeMinute = Math.max(0, Math.min(59, Math.trunc(minute)));
  return `${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`;
}

function timeParts(value: string) {
  const safeTime = nearestTimeOption(value);
  const [hour, minute] = safeTime.split(":");
  return { hour, minute };
}

function timeWithPart(value: string, part: TimePart, partValue: string) {
  const currentTimeParts = timeParts(value);
  return part === "hour"
    ? `${partValue}:${currentTimeParts.minute}`
    : `${currentTimeParts.hour}:${partValue}`;
}

function initialDraft(): Draft {
  const defaultDate = nextMinuteDate(new Date());

  return {
    name: "",
    type: recordTypes[0],
    date: dateKey(defaultDate),
    time: timeKey(defaultDate),
    amount: "",
    buyInCount: "1",
    tableBb: "",
    buyInCurrency: "$",
    result: "",
    note: "",
  };
}

function draftFromRecord(record: RecordItem, fallbackUsdCnyRate: number | null = null): Draft {
  const dateTime = recordDateTimeParts(record);
  const currency = recordBuyInCurrency(record);
  const usdCnyRate = recordUsdCnyRate(record) ?? fallbackUsdCnyRate;

  return {
    name: recordName(record),
    type: recordType(record),
    date: dateTime.date,
    time: nearestTimeOption(dateTime.time),
    amount: moneyFromUsdInputText(record.event.amount, currency, usdCnyRate),
    buyInCount: String(Math.max(1, record.event.buyInCount || 1)),
    tableBb: String(record.event.tableBb),
    buyInCurrency: currency,
    result: "",
    note: record.event.note ?? "",
  };
}

function weekdayText(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "星期几";
  return WEEKDAY_NAMES[date.getDay()];
}

function resultTone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function recordDisplayResult(record: RecordItem) {
  const result = displayResult(record.event);
  if (recordStatus(record) !== "已结束") return result;
  return result + (record.event.bounty ?? 0);
}

function recordStartDate(record: RecordItem) {
  const timestampDate = new Date(record.event.time);
  if (!Number.isNaN(timestampDate.getTime())) return timestampDate;

  const [year, month, day] = record.date.split("-").map(Number);
  const [hour, minute] = record.event.time.split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const startDate = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(startDate.getTime()) ? null : startDate;
}

function recordListStatus(record: RecordItem, now: Date): RecordListStatus {
  const status = recordStatus(record);
  const startDate = recordStartDate(record);
  if (status !== "已结束" && startDate && startDate.getTime() > now.getTime()) {
    return "未开始";
  }

  return status;
}

function recordDateTimeParts(record: RecordItem) {
  const timestampMatch = record.event.time.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (timestampMatch) {
    return {
      date: timestampMatch[1],
      time: timestampMatch[2],
      dateTime: record.event.time,
    };
  }

  return {
    date: record.date,
    time: record.event.time,
    dateTime: `${record.date}T${record.event.time}`,
  };
}

function formatDurationText(startDate: Date | null, endDate: Date) {
  if (!startDate) return "";

  const totalMinutes = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / 60000));
  if (totalMinutes < 60) return `${totalMinutes}分钟`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}小时${minutes}分钟`;
}

function displayDurationText(value: string | null) {
  if (!value || value === "已结束") return "";

  const legacyMatch = value.match(/^(\d+)h\s*(\d+)m$/i);
  if (legacyMatch) return `${legacyMatch[1]}小时${legacyMatch[2]}分钟`;

  return value;
}

function recordDurationText(record: RecordItem) {
  if (record.endedAt) {
    const endedAt = new Date(record.endedAt);
    if (!Number.isNaN(endedAt.getTime())) {
      return formatDurationText(recordStartDate(record), endedAt);
    }
  }

  return displayDurationText(record.event.durationText);
}

function isCnyCurrency(currency: BuyInCurrency) {
  return currency === "￥";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function recordBuyInCurrency(record: RecordItem): BuyInCurrency {
  return record.event.buyInCurrency ?? "$";
}

function recordUsdCnyRate(record: RecordItem) {
  const rate = record.event.exchangeRate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

function moneyInputText(value: number | null | undefined) {
  if (value == null) return "";
  return roundMoney(value).toFixed(2);
}

function positiveValueText(value: number | null | undefined) {
  return value != null && value > 0 ? String(value) : "";
}

function moneyFromUsdInputText(value: number | null | undefined, currency: BuyInCurrency, usdCnyRate: number | null) {
  if (value == null) return "";
  if (isCnyCurrency(currency) && usdCnyRate) return moneyInputText(value * usdCnyRate);
  return moneyInputText(value);
}

function moneyInputToUsd(value: number, currency: BuyInCurrency, usdCnyRate: number | null) {
  if (isCnyCurrency(currency) && usdCnyRate) return roundMoney(value / usdCnyRate);
  return roundMoney(value);
}

function totalBuyIn(record: RecordItem) {
  return roundMoney(record.event.amount * record.event.buyInCount);
}

function emptySettlementDraft(): SettlementDraft {
  return {
    result: "",
    bounty: "",
    rank: "",
    fieldSize: "",
    inMoney: "否",
    endDate: "",
    endTime: "",
  };
}

function settlementDraftFromRecord(record: RecordItem, fallbackUsdCnyRate: number | null = null): SettlementDraft {
  const displayedResult = displayResult(record.event);
  const settlementResult = displayedResult + totalBuyIn(record);
  const defaultEndDate = new Date();
  const currency = recordBuyInCurrency(record);
  const usdCnyRate = recordUsdCnyRate(record) ?? fallbackUsdCnyRate;

  return {
    result: moneyFromUsdInputText(settlementResult, currency, usdCnyRate),
    bounty: "",
    rank: positiveValueText(record.event.rank),
    fieldSize: positiveValueText(record.event.fieldSize),
    inMoney: "否",
    endDate: dateKey(defaultEndDate),
    endTime: timeKey(defaultEndDate),
  };
}

function optionalNumber(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;
  const nextValue = Number(trimmedValue);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function positiveOptionalNumber(value: string) {
  const nextValue = optionalNumber(value);
  return nextValue != null && nextValue > 0 ? nextValue : null;
}

function positiveIntegerText(value: string) {
  return value.replace(/\D/g, "").replace(/^0+/, "");
}

function hasValidNumber(value: string) {
  return value.trim() !== "" && optionalNumber(value) != null;
}

function hasValidRankFieldPair(rank: string, fieldSize: string) {
  const rankValue = positiveOptionalNumber(rank);
  const fieldSizeValue = positiveOptionalNumber(fieldSize);
  return rankValue != null && fieldSizeValue != null && rankValue <= fieldSizeValue;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  readOnly = false,
  invalid = false,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  invalid?: boolean;
  step?: string;
}) {
  const labelClassName = [
    readOnly ? "readonly-field" : "",
    invalid ? "field-invalid" : "",
  ].filter(Boolean).join(" ");

  return (
    <label className={labelClassName || undefined}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        step={step}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
    </label>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function RecordsPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [recordsEtag, setRecordsEtag] = useState<string | null>(null);
  const [recordsError, setRecordsError] = useState("");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [isRecordSaving, setIsRecordSaving] = useState(false);
  const [settlementDraft, setSettlementDraft] = useState<SettlementDraft>(() => emptySettlementDraft());
  const [settlementAction, setSettlementAction] = useState<"" | "finish">("");
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(() => initialDraft());
  const [editFieldErrors, setEditFieldErrors] = useState<Partial<Record<RequiredDraftField, boolean>>>({});
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false);
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isEditTypeMenuOpen, setIsEditTypeMenuOpen] = useState(false);
  const [isEditCurrencyMenuOpen, setIsEditCurrencyMenuOpen] = useState(false);
  const [isEditDatePickerOpen, setIsEditDatePickerOpen] = useState(false);
  const [isSettlementTimePickerOpen, setIsSettlementTimePickerOpen] = useState(false);
  const [isMoneyStatusMenuOpen, setIsMoneyStatusMenuOpen] = useState(false);
  const [settlementUsdCnyRate, setSettlementUsdCnyRate] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft());
  const [calendarMonth, setCalendarMonth] = useState(() => monthStartFromDateKey(draft.date));
  const [editCalendarMonth, setEditCalendarMonth] = useState(() => monthStartFromDateKey(editDraft.date));
  const [settlementCalendarMonth, setSettlementCalendarMonth] = useState(() => monthStartFromDateKey(dateKey(new Date())));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredDraftField, boolean>>>({});
  const [recordPage, setRecordPage] = useState(1);
  const [toast, setToast] = useState("");
  const [deletingRecordId, setDeletingRecordId] = useState("");
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialog | null>(null);
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const typePickerRef = useRef<HTMLDivElement | null>(null);
  const currencyPickerRef = useRef<HTMLDivElement | null>(null);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const editTypePickerRef = useRef<HTMLDivElement | null>(null);
  const editCurrencyPickerRef = useRef<HTMLDivElement | null>(null);
  const editDatePickerRef = useRef<HTMLDivElement | null>(null);
  const settlementTimePickerRef = useRef<HTMLDivElement | null>(null);
  const moneyStatusPickerRef = useRef<HTMLDivElement | null>(null);
  const draftHourWheelRef = useRef<HTMLDivElement | null>(null);
  const draftMinuteWheelRef = useRef<HTMLDivElement | null>(null);
  const editHourWheelRef = useRef<HTMLDivElement | null>(null);
  const editMinuteWheelRef = useRef<HTMLDivElement | null>(null);
  const settlementHourWheelRef = useRef<HTMLDivElement | null>(null);
  const settlementMinuteWheelRef = useRef<HTMLDivElement | null>(null);
  const draftHourScrollTimerRef = useRef<number | null>(null);
  const draftMinuteScrollTimerRef = useRef<number | null>(null);
  const editHourScrollTimerRef = useRef<number | null>(null);
  const editMinuteScrollTimerRef = useRef<number | null>(null);
  const settlementHourScrollTimerRef = useRef<number | null>(null);
  const settlementMinuteScrollTimerRef = useRef<number | null>(null);
  const isRecordModalOpen = Boolean(editingRecord) || Boolean(confirmationDialog);

  useEffect(() => {
    if (!isRecordModalOpen) return;

    const { body, documentElement } = document;
    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const currentPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    const previousStyles = {
      left: body.style.left,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.left = "0";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.right = "0";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }

    return () => {
      body.style.left = previousStyles.left;
      body.style.overflow = previousStyles.overflow;
      body.style.paddingRight = previousStyles.paddingRight;
      body.style.position = previousStyles.position;
      body.style.right = previousStyles.right;
      body.style.top = previousStyles.top;
      body.style.width = previousStyles.width;
      window.scrollTo(0, scrollY);
    };
  }, [isRecordModalOpen]);

  useEffect(() => {
    let isActive = true;

    async function loadRecords() {
      setIsRecordsLoading(true);
      setRecordsError("");

      try {
        const data = await requestRecordsSnapshot();

        if (!isActive) return;
        setRecords(data.records ?? []);
        setRecordsEtag(data.etag ?? null);
      } catch (error) {
        if (!isActive) return;
        setRecords([]);
        setRecordsEtag(null);
        setRecordsError(error instanceof Error ? error.message : "无法读取记录");
        setToast("记录同步失败");
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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const draftHourScrollTimer = draftHourScrollTimerRef;
    const draftMinuteScrollTimer = draftMinuteScrollTimerRef;
    const editHourScrollTimer = editHourScrollTimerRef;
    const editMinuteScrollTimer = editMinuteScrollTimerRef;
    const settlementHourScrollTimer = settlementHourScrollTimerRef;
    const settlementMinuteScrollTimer = settlementMinuteScrollTimerRef;

    return () => {
      if (draftHourScrollTimer.current) window.clearTimeout(draftHourScrollTimer.current);
      if (draftMinuteScrollTimer.current) window.clearTimeout(draftMinuteScrollTimer.current);
      if (editHourScrollTimer.current) window.clearTimeout(editHourScrollTimer.current);
      if (editMinuteScrollTimer.current) window.clearTimeout(editMinuteScrollTimer.current);
      if (settlementHourScrollTimer.current) window.clearTimeout(settlementHourScrollTimer.current);
      if (settlementMinuteScrollTimer.current) window.clearTimeout(settlementMinuteScrollTimer.current);
    };
  }, []);

  useEffect(() => {
    if (
      !isTypeMenuOpen &&
      !isCurrencyMenuOpen &&
      !isDatePickerOpen &&
      !isEditTypeMenuOpen &&
      !isEditCurrencyMenuOpen &&
      !isEditDatePickerOpen &&
      !isSettlementTimePickerOpen &&
      !isMoneyStatusMenuOpen
    ) return;

    function closePickersOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (isTypeMenuOpen && !typePickerRef.current?.contains(target)) {
        setIsTypeMenuOpen(false);
      }

      if (isCurrencyMenuOpen && !currencyPickerRef.current?.contains(target)) {
        setIsCurrencyMenuOpen(false);
      }

      if (isDatePickerOpen && !datePickerRef.current?.contains(target)) {
        setIsDatePickerOpen(false);
      }

      if (isEditTypeMenuOpen && !editTypePickerRef.current?.contains(target)) {
        setIsEditTypeMenuOpen(false);
      }

      if (isEditCurrencyMenuOpen && !editCurrencyPickerRef.current?.contains(target)) {
        setIsEditCurrencyMenuOpen(false);
      }

      if (isEditDatePickerOpen && !editDatePickerRef.current?.contains(target)) {
        setIsEditDatePickerOpen(false);
      }

      if (isSettlementTimePickerOpen && !settlementTimePickerRef.current?.contains(target)) {
        setIsSettlementTimePickerOpen(false);
      }

      if (isMoneyStatusMenuOpen && !moneyStatusPickerRef.current?.contains(target)) {
        setIsMoneyStatusMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closePickersOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closePickersOnOutsidePointerDown);
  }, [
    isTypeMenuOpen,
    isCurrencyMenuOpen,
    isDatePickerOpen,
    isEditTypeMenuOpen,
    isEditCurrencyMenuOpen,
    isEditDatePickerOpen,
    isSettlementTimePickerOpen,
    isMoneyStatusMenuOpen,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const delta = useMemo(
    () => records.reduce((total, record) => total + recordDisplayResult(record), 0),
    [records],
  );
  const current = delta;
  const hasRecords = records.length > 0;
  const hasRecordsError = Boolean(recordsError);
  const isRecordMutating = isRecordSaving || isEditSaving || Boolean(settlementAction) || Boolean(deletingRecordId);
  const pageCount = Math.max(1, Math.ceil(records.length / RECORDS_PER_PAGE));
  const currentPage = Math.min(recordPage, pageCount);
  const pageStart = (currentPage - 1) * RECORDS_PER_PAGE;
  const pageRecords = records.slice(pageStart, pageStart + RECORDS_PER_PAGE);
  const pageRangeStart = records.length === 0 ? 0 : pageStart + 1;
  const pageRangeEnd = Math.min(records.length, pageStart + RECORDS_PER_PAGE);
  const pagerRangeText = isRecordsLoading
    ? "读取中"
    : hasRecordsError
      ? "同步失败"
      : hasRecords
      ? `${pageRangeStart}-${pageRangeEnd} / ${records.length}`
      : "等待第一条记录";
  const pagerPageText = isRecordsLoading || hasRecordsError ? "..." : hasRecords ? `${currentPage} / ${pageCount}` : "0 / 0";
  const editCalendarDaysForMonth = useMemo(() => calendarDays(editCalendarMonth), [editCalendarMonth]);

  function isRequiredDraftField(field: keyof Draft): field is RequiredDraftField {
    return requiredDraftFields.includes(field as RequiredDraftField);
  }

  function updateDraft(field: keyof Draft, value: string) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
    if (!isRequiredDraftField(field)) return;
    setFieldErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors;
      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  function updateEditDraft(field: keyof Draft, value: string) {
    setEditDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
    if (!isRequiredDraftField(field)) return;
    setEditFieldErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors;
      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  async function loadUsdCnyRate() {
    try {
      const response = await fetch("/api/exchange-rate", { cache: "no-store" });
      const data = (await response.json()) as ExchangeRateApiResponse;

      if (!response.ok || data.base !== "USD" || data.quote !== "CNY" || typeof data.rate !== "number") {
        throw new Error(data.error || "汇率读取失败");
      }

      return {
        rate: data.rate,
        date: data.date ?? null,
      };
    } catch (error) {
      setToast(error instanceof Error ? error.message : "汇率读取失败，请稍后再试");
      return null;
    }
  }

  function scrollTimePartOptionIntoView(value: string, containerGetter: () => HTMLDivElement | null) {
    window.requestAnimationFrame(() => {
      const container = containerGetter();
      const option = container?.querySelector<HTMLElement>(`[data-time-part="${value}"]`);
      if (!container || !option) return;
      container.scrollTop = option.offsetTop - container.clientHeight / 2 + option.offsetHeight / 2;
    });
  }

  function scrollDraftTimePartsIntoView(value: string) {
    const currentTimeParts = timeParts(value);
    scrollTimePartOptionIntoView(currentTimeParts.hour, () => draftHourWheelRef.current);
    scrollTimePartOptionIntoView(currentTimeParts.minute, () => draftMinuteWheelRef.current);
  }

  function scrollEditTimePartsIntoView(value: string) {
    const currentTimeParts = timeParts(value);
    scrollTimePartOptionIntoView(currentTimeParts.hour, () => editHourWheelRef.current);
    scrollTimePartOptionIntoView(currentTimeParts.minute, () => editMinuteWheelRef.current);
  }

  function scrollSettlementTimePartsIntoView(value: string) {
    const currentTimeParts = timeParts(value);
    scrollTimePartOptionIntoView(currentTimeParts.hour, () => settlementHourWheelRef.current);
    scrollTimePartOptionIntoView(currentTimeParts.minute, () => settlementMinuteWheelRef.current);
  }

  function toggleDatePicker() {
    setIsTypeMenuOpen(false);
    setIsCurrencyMenuOpen(false);

    if (isDatePickerOpen) {
      setIsDatePickerOpen(false);
      return;
    }

    const safeTime = nearestTimeOption(draft.time);
    setCalendarMonth(monthStartFromDateKey(draft.date));
    if (safeTime !== draft.time) updateDraft("time", safeTime);
    setIsDatePickerOpen(true);
    scrollDraftTimePartsIntoView(safeTime);
  }

  function selectCalendarDate(value: string) {
    updateDraft("date", value);
    setCalendarMonth(monthStartFromDateKey(value));
  }

  function updateDraftTimePart(part: TimePart, value: string) {
    setDraft((currentDraft) => {
      const nextTime = timeWithPart(currentDraft.time, part, value);
      if (nextTime === currentDraft.time) return currentDraft;
      return { ...currentDraft, time: nextTime };
    });
  }

  function updateEditTimePart(part: TimePart, value: string) {
    setEditDraft((currentDraft) => {
      const nextTime = timeWithPart(currentDraft.time, part, value);
      if (nextTime === currentDraft.time) return currentDraft;
      return { ...currentDraft, time: nextTime };
    });
  }

  function updateSettlementTimePart(part: TimePart, value: string) {
    setSettlementDraft((currentDraft) => {
      const nextTime = timeWithPart(currentDraft.endTime, part, value);
      if (nextTime === currentDraft.endTime) return currentDraft;
      return { ...currentDraft, endTime: nextTime };
    });
  }

  function toggleEditDatePicker() {
    if (isEditSaving) return;
    setIsEditTypeMenuOpen(false);
    setIsEditCurrencyMenuOpen(false);

    if (isEditDatePickerOpen) {
      setIsEditDatePickerOpen(false);
      return;
    }

    const safeTime = nearestTimeOption(editDraft.time);
    setEditCalendarMonth(monthStartFromDateKey(editDraft.date));
    if (safeTime !== editDraft.time) updateEditDraft("time", safeTime);
    setIsEditDatePickerOpen(true);
    scrollEditTimePartsIntoView(safeTime);
  }

  function selectEditCalendarDate(value: string) {
    updateEditDraft("date", value);
    setEditCalendarMonth(monthStartFromDateKey(value));
  }

  function selectSettlementCalendarDate(value: string) {
    updateSettlementDraft("endDate", value);
    setSettlementCalendarMonth(monthStartFromDateKey(value));
  }

  function toggleSettlementTimePicker() {
    if (settlementAction) return;

    const fallbackDate = new Date();
    const fallbackEndDate = dateKey(fallbackDate);
    const safeEndDate = settlementDraft.endDate || fallbackEndDate;
    const safeTime = SETTLEMENT_TIME_OPTIONS.includes(settlementDraft.endTime)
      ? settlementDraft.endTime
      : timeKey(fallbackDate);

    if (safeTime !== settlementDraft.endTime || !settlementDraft.endDate) {
      setSettlementDraft((currentDraft) => ({
        ...currentDraft,
        endDate: currentDraft.endDate || fallbackEndDate,
        endTime: safeTime,
      }));
    }

    setIsCurrencyMenuOpen(false);
    setIsEditTypeMenuOpen(false);
    setIsEditCurrencyMenuOpen(false);
    setIsEditDatePickerOpen(false);
    setIsMoneyStatusMenuOpen(false);
    setSettlementCalendarMonth(monthStartFromDateKey(safeEndDate));
    setIsSettlementTimePickerOpen((isOpen) => !isOpen);
    scrollSettlementTimePartsIntoView(safeTime);
  }

  function toggleMoneyStatusMenu() {
    if (settlementAction) return;
    setIsCurrencyMenuOpen(false);
    setIsEditTypeMenuOpen(false);
    setIsEditCurrencyMenuOpen(false);
    setIsEditDatePickerOpen(false);
    setIsSettlementTimePickerOpen(false);
    setIsMoneyStatusMenuOpen((isOpen) => !isOpen);
  }

  function selectMoneyStatus(value: MoneyBubbleStatus) {
    updateSettlementDraft("inMoney", value);
    setIsMoneyStatusMenuOpen(false);
  }

  function closestTimePartFromWheel(container: HTMLDivElement) {
    const options = Array.from(container.querySelectorAll<HTMLElement>("[data-time-part]"));
    const center = container.scrollTop + container.clientHeight / 2;
    let closestValue = options[0]?.dataset.timePart ?? "";
    let closestDistance = Number.POSITIVE_INFINITY;

    options.forEach((option) => {
      const optionCenter = option.offsetTop + option.offsetHeight / 2;
      const distance = Math.abs(optionCenter - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestValue = option.dataset.timePart ?? closestValue;
      }
    });

    return closestValue;
  }

  function syncDraftTimePartFromWheel(part: TimePart, container: HTMLDivElement) {
    const closestValue = closestTimePartFromWheel(container);
    if (closestValue) updateDraftTimePart(part, closestValue);
  }

  function syncEditTimePartFromWheel(part: TimePart, container: HTMLDivElement) {
    const closestValue = closestTimePartFromWheel(container);
    if (closestValue) updateEditTimePart(part, closestValue);
  }

  function syncSettlementTimePartFromWheel(part: TimePart, container: HTMLDivElement) {
    const closestValue = closestTimePartFromWheel(container);
    if (closestValue) updateSettlementTimePart(part, closestValue);
  }

  function handleDraftTimePartWheelScroll(part: TimePart, event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const timerRef = part === "hour" ? draftHourScrollTimerRef : draftMinuteScrollTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => syncDraftTimePartFromWheel(part, container), 90);
  }

  function handleEditTimePartWheelScroll(part: TimePart, event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const timerRef = part === "hour" ? editHourScrollTimerRef : editMinuteScrollTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => syncEditTimePartFromWheel(part, container), 90);
  }

  function handleSettlementTimePartWheelScroll(part: TimePart, event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const timerRef = part === "hour" ? settlementHourScrollTimerRef : settlementMinuteScrollTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => syncSettlementTimePartFromWheel(part, container), 90);
  }

  async function saveRecord(record: RecordItem) {
    setIsRecordSaving(true);

    try {
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record, etag: recordsEtag }),
      });
      const data = (await response.json()) as RecordsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "保存失败");
      }

      setRecords(data.records ?? [record, ...records]);
      setRecordsEtag(data.etag ?? null);
      setRecordsError("");
      setIsRecordsLoading(false);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请稍后再试");
      return false;
    } finally {
      setIsRecordSaving(false);
    }
  }

  async function createRecord() {
    if (isRecordsLoading || isRecordMutating) return;

    const nextFieldErrors = requiredDraftFields.reduce<Partial<Record<RequiredDraftField, boolean>>>((errors, field) => {
      if (!draft[field].trim()) errors[field] = true;
      return errors;
    }, {});
    const missingFields = requiredDraftFields.filter((field) => nextFieldErrors[field]);
    if (missingFields.length) {
      setFieldErrors(nextFieldErrors);
      setToast(`请填写${missingFields.map((field) => requiredFieldNames[field]).join("、")}`);
      return;
    }

    const exchangeRate = isCnyCurrency(draft.buyInCurrency) ? await loadUsdCnyRate() : null;
    if (isCnyCurrency(draft.buyInCurrency) && !exchangeRate) return;

    const usdCnyRate = exchangeRate?.rate ?? null;
    const amount = moneyInputToUsd(Number(draft.amount) || 0, draft.buyInCurrency, usdCnyRate);
    const buyInCount = Math.max(1, Number(draft.buyInCount) || 1);
    const resultInput = Number(draft.result);
    const hasResult = draft.result.trim() !== "" && Number.isFinite(resultInput);
    const result = hasResult ? moneyInputToUsd(resultInput, draft.buyInCurrency, usdCnyRate) : null;
    const event: RecordEvent = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      time: localTimestamp(dateFromDateTimeKeys(draft.date, draft.time)),
      matchName: `${draft.name.trim()} - ${draft.type}`,
      amount,
      buyInCount,
      tableBb: Number(draft.tableBb) || 0,
      bounty: null,
      rank: null,
      fieldSize: null,
      result,
      currentResult: result ?? -roundMoney(amount * buyInCount),
      platform: "GG Poker",
      buyInCurrency: draft.buyInCurrency,
      exchangeRate: usdCnyRate,
      exchangeRateDate: exchangeRate?.date ?? null,
      durationText: hasResult ? "已结束" : null,
      note: draft.note.trim() || null,
    };

    const saved = await saveRecord({
      date: draft.date,
      createdAt: localTimestamp(new Date()),
      endedAt: null,
      updatedAt: null,
      status: "进行中",
      event,
    });
    if (!saved) return;

    setDraft(initialDraft());
    setFieldErrors({});
    setRecordPage(1);
    setToast("记录已加入");
  }

  function closeConfirmation() {
    if (isConfirmingAction) return;
    setConfirmationDialog(null);
  }

  async function confirmAction() {
    if (!confirmationDialog || isConfirmingAction) return;

    const currentDialog = confirmationDialog;
    setIsConfirmingAction(true);

    try {
      await currentDialog.onConfirm();
      setConfirmationDialog(null);
    } finally {
      setIsConfirmingAction(false);
    }
  }

  async function deleteRecord(record: RecordItem, options: { confirmed?: boolean; mode?: RecordDeleteMode } = {}) {
    if (isRecordsLoading || isRecordMutating) return;

    const mode = options.mode ?? "cancel";
    const isDeleteMode = mode === "delete";

    if (!isDeleteMode && recordListStatus(record, new Date()) !== "未开始") {
      setToast("只能取消未开始比赛");
      return;
    }

    if (!options.confirmed) {
      if (editingRecord?.event.id === record.event.id) {
        closeEditRecord();
      }

      setConfirmationDialog({
        title: isDeleteMode ? "删除这条记录？" : "取消这场比赛？",
        message: isDeleteMode
          ? `「${recordName(record)}」会从记录里删除，相关金额也会从统计中移除。`
          : `「${recordName(record)}」还未开始，确认后会从记录里删除。`,
        confirmLabel: isDeleteMode ? "删除记录" : "取消比赛",
        cancelLabel: "先保留",
        tone: "danger",
        onConfirm: () => deleteRecord(record, { confirmed: true, mode }),
      });
      return;
    }

    const nextRecords = records.filter((item) => item.event.id !== record.event.id);
    setDeletingRecordId(record.event.id);

    try {
      const response = await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.event.id, etag: recordsEtag }),
      });
      const data = (await response.json()) as RecordsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || (isDeleteMode ? "删除失败" : "取消失败"));
      }

      const syncedRecords = data.records ?? nextRecords;
      setRecords(syncedRecords);
      setRecordsEtag(data.etag ?? null);
      setRecordPage((page) => Math.min(page, Math.max(1, Math.ceil(syncedRecords.length / RECORDS_PER_PAGE))));
      setRecordsError("");
      if (editingRecord?.event.id === record.event.id) {
        setEditingRecord(null);
        setEditDraft(initialDraft());
        setEditFieldErrors({});
        setIsEditTypeMenuOpen(false);
        setIsEditCurrencyMenuOpen(false);
        setIsEditDatePickerOpen(false);
      }
      setToast(isDeleteMode ? "记录已删除" : "比赛已取消");
    } catch (error) {
      setToast(error instanceof Error ? error.message : isDeleteMode ? "删除失败，请稍后再试" : "取消失败，请稍后再试");
    } finally {
      setDeletingRecordId("");
    }
  }

  async function openEditRecord(record: RecordItem) {
    if (isRecordsLoading || isRecordMutating) return;
    setIsTypeMenuOpen(false);
    setIsCurrencyMenuOpen(false);
    setIsDatePickerOpen(false);
    setIsEditTypeMenuOpen(false);
    setIsEditCurrencyMenuOpen(false);
    setIsEditDatePickerOpen(false);
    setIsSettlementTimePickerOpen(false);
    setIsMoneyStatusMenuOpen(false);
    setSettlementUsdCnyRate(null);
    setSettlementDraft(emptySettlementDraft());

    const currency = recordBuyInCurrency(record);
    let usdCnyRate = recordUsdCnyRate(record);
    if (isCnyCurrency(currency) && !usdCnyRate) {
      const exchangeRate = await loadUsdCnyRate();
      if (!exchangeRate) return;
      usdCnyRate = exchangeRate.rate;
    }

    const nextDraft = draftFromRecord(record, usdCnyRate);
    const status = recordListStatus(record, new Date());
    const nextSettlementDraft = status === "进行中" ? settlementDraftFromRecord(record, usdCnyRate) : emptySettlementDraft();
    setEditingRecord(record);
    setEditDraft(nextDraft);
    setEditCalendarMonth(monthStartFromDateKey(nextDraft.date));
    setEditFieldErrors({});
    setSettlementUsdCnyRate(status === "进行中" ? usdCnyRate : null);
    setSettlementCalendarMonth(monthStartFromDateKey(nextSettlementDraft.endDate || dateKey(new Date())));
    setSettlementDraft(nextSettlementDraft);
  }

  function closeEditRecord() {
    if (isEditSaving) return;
    setIsEditTypeMenuOpen(false);
    setIsEditCurrencyMenuOpen(false);
    setIsEditDatePickerOpen(false);
    setIsSettlementTimePickerOpen(false);
    setIsMoneyStatusMenuOpen(false);
    setSettlementUsdCnyRate(null);
    setSettlementDraft(emptySettlementDraft());
    setEditingRecord(null);
    setEditDraft(initialDraft());
    setEditFieldErrors({});
  }

  async function saveEditRecord() {
    if (!editingRecord || isRecordsLoading || isEditSaving) return;

    const nextFieldErrors = requiredDraftFields.reduce<Partial<Record<RequiredDraftField, boolean>>>((errors, field) => {
      if (!editDraft[field].trim()) errors[field] = true;
      return errors;
    }, {});
    const missingFields = requiredDraftFields.filter((field) => nextFieldErrors[field]);
    if (missingFields.length) {
      setEditFieldErrors(nextFieldErrors);
      setToast(`请填写${missingFields.map((field) => requiredFieldNames[field]).join("、")}`);
      return;
    }

    const amountValue = optionalNumber(editDraft.amount);
    if (amountValue == null) {
      setEditFieldErrors((currentErrors) => ({ ...currentErrors, amount: true }));
      setToast("请输入有效买入");
      return;
    }

    const tableBbValue = optionalNumber(editDraft.tableBb);
    if (tableBbValue == null) {
      setEditFieldErrors((currentErrors) => ({ ...currentErrors, tableBb: true }));
      setToast("请输入有效当前级别");
      return;
    }

    const shouldSaveBounty = recordListStatus(editingRecord, new Date()) === "进行中" &&
      isBountyRecordType(editDraft.type) &&
      settlementDraft.bounty.trim() !== "";
    const bountyValue = optionalNumber(settlementDraft.bounty);
    if (shouldSaveBounty && bountyValue == null) {
      setToast("请输入有效赏金");
      return;
    }

    setIsEditSaving(true);

    try {
      const previousCurrency = recordBuyInCurrency(editingRecord);
      const shouldRefreshCnyRate = isCnyCurrency(editDraft.buyInCurrency) && previousCurrency !== "￥";
      let exchangeRateValue = isCnyCurrency(editDraft.buyInCurrency) ? recordUsdCnyRate(editingRecord) : null;
      let exchangeRateDate = isCnyCurrency(editDraft.buyInCurrency) ? editingRecord.event.exchangeRateDate ?? null : null;

      if (isCnyCurrency(editDraft.buyInCurrency) && (!exchangeRateValue || shouldRefreshCnyRate)) {
        const exchangeRate = await loadUsdCnyRate();
        if (!exchangeRate) return;
        exchangeRateValue = exchangeRate.rate;
        exchangeRateDate = exchangeRate.date;
      }

      const bountyCurrency = recordBuyInCurrency(editingRecord);
      let bountyUsdCnyRate = recordUsdCnyRate(editingRecord) ?? settlementUsdCnyRate;
      if (shouldSaveBounty && isCnyCurrency(bountyCurrency) && !bountyUsdCnyRate) {
        const exchangeRate = await loadUsdCnyRate();
        if (!exchangeRate) return;
        bountyUsdCnyRate = exchangeRate.rate;
      }

      const bountyValueUsd = shouldSaveBounty && bountyValue != null
        ? moneyInputToUsd(bountyValue, bountyCurrency, bountyUsdCnyRate)
        : null;
      const nextBountyUsd = shouldSaveBounty
        ? roundMoney((editingRecord.event.bounty ?? 0) + (bountyValueUsd ?? 0))
        : undefined;
      const nextAmount = moneyInputToUsd(amountValue, editDraft.buyInCurrency, exchangeRateValue);
      const nextBuyInCount = Math.max(1, Number(editDraft.buyInCount) || 1);
      const nextTotalBuyIn = roundMoney(nextAmount * nextBuyInCount);
      const isEnded = recordStatus(editingRecord) === "已结束";
      const previousPayout = editingRecord.event.result == null
        ? null
        : roundMoney(editingRecord.event.result + totalBuyIn(editingRecord));
      const nextResult = isEnded && previousPayout != null
        ? roundMoney(previousPayout - nextTotalBuyIn)
        : editingRecord.event.result;
      const nextCurrentResult = isEnded
        ? nextResult ?? editingRecord.event.currentResult
        : roundMoney(-nextTotalBuyIn);
      const startDate = dateFromDateTimeKeys(editDraft.date, editDraft.time);
      const endedAtDate = editingRecord.endedAt ? new Date(editingRecord.endedAt) : null;
      const nextDurationText = isEnded && endedAtDate && !Number.isNaN(endedAtDate.getTime())
        ? formatDurationText(startDate, endedAtDate)
        : editingRecord.event.durationText;
      const updatedAt = localTimestamp(new Date());
      const nextEvent: RecordPatchPayload["event"] = {
        time: localTimestamp(startDate),
        matchName: `${editDraft.name.trim()} - ${editDraft.type}`,
        amount: nextAmount,
        buyInCount: nextBuyInCount,
        tableBb: tableBbValue,
        result: nextResult,
        currentResult: nextCurrentResult,
        platform: "GG Poker",
        buyInCurrency: editDraft.buyInCurrency,
        exchangeRate: exchangeRateValue,
        exchangeRateDate,
        durationText: nextDurationText,
        note: editDraft.note.trim() || null,
        ...(nextBountyUsd !== undefined ? { bounty: nextBountyUsd } : {}),
      };
      const patchPayload: RecordPatchPayload = {
        id: editingRecord.event.id,
        date: editDraft.date,
        updatedAt,
        event: nextEvent,
      };
      const nextRecords = records.map((item) => item.event.id === editingRecord.event.id
        ? {
            ...item,
            date: editDraft.date,
            updatedAt,
            event: {
              ...item.event,
              ...nextEvent,
            },
          }
        : item);

      const response = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchPayload),
      });
      const data = (await response.json()) as RecordsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "修改失败");
      }

      setRecords(data.records ?? nextRecords);
      setRecordsEtag(data.etag ?? null);
      setRecordsError("");
      setNow(new Date());
      setToast("修改已保存");
      setEditingRecord(null);
      setEditDraft(initialDraft());
      setEditFieldErrors({});
      setIsEditTypeMenuOpen(false);
      setIsEditCurrencyMenuOpen(false);
      setIsEditDatePickerOpen(false);
      setIsSettlementTimePickerOpen(false);
      setIsMoneyStatusMenuOpen(false);
      setSettlementUsdCnyRate(null);
      setSettlementDraft(emptySettlementDraft());
    } catch (error) {
      setToast(error instanceof Error ? error.message : "修改失败，请稍后再试");
    } finally {
      setIsEditSaving(false);
    }
  }

  function updateSettlementDraft(field: keyof SettlementDraft, value: string) {
    const nextValue = field === "rank" || field === "fieldSize"
      ? positiveIntegerText(value)
      : value;
    setSettlementDraft((currentDraft) => ({ ...currentDraft, [field]: nextValue }));
  }

  async function saveSettlement(
    options: {
      confirmed?: boolean;
      record: RecordItem;
      draft: SettlementDraft;
      usdCnyRate?: number | null;
      closeEditOnConfirmDialog?: boolean;
    },
  ) {
    const activeRecord = options.record;
    const activeDraft = options.draft;
    if (isRecordsLoading || settlementAction) return;

    const resultValue = optionalNumber(activeDraft.result);
    const bountyValue = optionalNumber(activeDraft.bounty);
    const rankValue = positiveOptionalNumber(activeDraft.rank);
    const fieldSizeValue = positiveOptionalNumber(activeDraft.fieldSize);
    const isBounty = isBountyRecord(activeRecord);
    const isInMoney = activeDraft.inMoney === "是";

    if (activeDraft.bounty.trim() && bountyValue == null) {
      setToast("请输入有效赏金");
      return;
    }

    if (
      (!activeDraft.endDate || !SETTLEMENT_TIME_OPTIONS.includes(activeDraft.endTime))
    ) {
      setToast("请选择有效结束时间");
      return;
    }

    if (isInMoney && (activeDraft.result.trim() === "" || resultValue == null)) {
      setToast("请输入有效战绩");
      return;
    }

    if (isInMoney && (activeDraft.rank.trim() === "" || rankValue == null)) {
      setToast("请输入有效名次");
      return;
    }

    if (isInMoney && (activeDraft.fieldSize.trim() === "" || fieldSizeValue == null)) {
      setToast("请输入有效实际人数");
      return;
    }

    if (isInMoney && rankValue != null && fieldSizeValue != null && rankValue > fieldSizeValue) {
      setToast("名次不能大于实际人数");
      return;
    }

    const activeCurrency = recordBuyInCurrency(activeRecord);
    let activeUsdCnyRate = options.usdCnyRate ?? recordUsdCnyRate(activeRecord) ?? settlementUsdCnyRate;
    if (isCnyCurrency(activeCurrency) && !activeUsdCnyRate) {
      const exchangeRate = await loadUsdCnyRate();
      if (!exchangeRate) return;
      activeUsdCnyRate = exchangeRate.rate;
    }

    const resultValueUsd = resultValue == null
      ? null
      : moneyInputToUsd(resultValue, activeCurrency, activeUsdCnyRate);
    const bountyValueUsd = bountyValue == null
      ? null
      : moneyInputToUsd(bountyValue, activeCurrency, activeUsdCnyRate);
    const currentBountyUsd = isBounty ? activeRecord.event.bounty ?? 0 : 0;
    const nextBountyUsd = isBounty ? roundMoney(currentBountyUsd + (bountyValueUsd ?? 0)) : null;

    if (!options.confirmed) {
      const finishTimeText = `${activeDraft.endDate} ${activeDraft.endTime}`;
      const finishMessage = isInMoney
        ? "将保存「" + recordName(activeRecord) + "」当前战绩、实际名次和 " + finishTimeText + " 的结束时间。"
        : "将保存「" + recordName(activeRecord) + "」未进入钱圈，并记录 " + finishTimeText + " 的结束时间。";

      setConfirmationDialog({
        title: "结束这场比赛？",
        message: finishMessage,
        confirmLabel: "结束比赛",
        cancelLabel: "取消",
        tone: "finish",
        onConfirm: () => saveSettlement({
          confirmed: true,
          record: activeRecord,
          draft: activeDraft,
          usdCnyRate: activeUsdCnyRate,
        }),
      });
      setIsSettlementTimePickerOpen(false);
      setIsMoneyStatusMenuOpen(false);
      setSettlementUsdCnyRate(null);
      setSettlementDraft(emptySettlementDraft());
      if (options.closeEditOnConfirmDialog) closeEditRecord();
      return;
    }

    const settlementResult = !isInMoney ? 0 : resultValueUsd ?? 0;
    const nextResult = roundMoney(settlementResult - totalBuyIn(activeRecord));
    const actionDate = dateFromDateTimeKeys(activeDraft.endDate, activeDraft.endTime);
    const actionTimestamp = localTimestamp(actionDate);
    const finishedDurationText = formatDurationText(recordStartDate(activeRecord), actionDate);
    const patchPayload: RecordPatchPayload = {
      id: activeRecord.event.id,
      status: "已结束",
      endedAt: actionTimestamp,
      updatedAt: actionTimestamp,
      event: {
        bounty: nextBountyUsd,
        rank: isInMoney ? rankValue : null,
        fieldSize: isInMoney ? fieldSizeValue : null,
        result: nextResult,
        currentResult: nextResult,
        durationText: finishedDurationText,
      },
    };
    const nextRecords: RecordItem[] = records.map((item) => {
      if (item.event.id !== activeRecord.event.id) return item;

      return {
        ...item,
        status: "已结束",
        endedAt: actionTimestamp,
        updatedAt: actionTimestamp,
        event: {
          ...item.event,
          bounty: nextBountyUsd,
          rank: isInMoney ? rankValue : null,
          fieldSize: isInMoney ? fieldSizeValue : null,
          result: nextResult,
          currentResult: nextResult,
          durationText: finishedDurationText,
        },
      };
    });

    setSettlementAction("finish");

    try {
      const response = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchPayload),
      });
      const data = (await response.json()) as RecordsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "结束失败");
      }

      setRecords(data.records ?? nextRecords);
      setRecordsEtag(data.etag ?? null);
      setRecordsError("");
      setToast("比赛已结束");
      setSettlementUsdCnyRate(null);
      setSettlementDraft(emptySettlementDraft());
      setIsSettlementTimePickerOpen(false);
      setIsMoneyStatusMenuOpen(false);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请稍后再试");
    } finally {
      setSettlementAction("");
    }
  }

  const hasSettlementEndTime = Boolean(
    settlementDraft.endDate && SETTLEMENT_TIME_OPTIONS.includes(settlementDraft.endTime),
  );
  const hasSettlementRankFieldPair = hasValidRankFieldPair(
    settlementDraft.rank,
    settlementDraft.fieldSize,
  );
  const calendarDaysForMonth = useMemo(() => calendarDays(calendarMonth), [calendarMonth]);
  const settlementCalendarDaysForMonth = useMemo(
    () => calendarDays(settlementCalendarMonth),
    [settlementCalendarMonth],
  );
  const draftTimeParts = timeParts(draft.time);
  const editTimeParts = timeParts(editDraft.time);
  const settlementTimeParts = timeParts(settlementDraft.endTime || "00:00");
  const editingStatus = editingRecord ? recordListStatus(editingRecord, now) : null;
  const isEditingNotStarted = editingStatus === "未开始";
  const isEditingOngoing = editingStatus === "进行中";
  const canDeleteEditingRecord = editingStatus === "进行中" || editingStatus === "已结束";
  const isEditSettlementBounty = editingRecord ? isBountyRecordType(editDraft.type) : false;
  const editSettlementCurrency = editingRecord ? recordBuyInCurrency(editingRecord) : "$";
  const isEditSettlementInMoney = settlementDraft.inMoney === "是";
  const canFinishEditSettlement =
    isEditingOngoing &&
    hasSettlementEndTime &&
    (!isEditSettlementInMoney ||
      (hasValidNumber(settlementDraft.result) && hasSettlementRankFieldPair)) &&
    !settlementAction &&
    !isEditSaving &&
    !deletingRecordId;

  return (
    <>
    <main className="page-canvas">
      <section className="split-page records-page">
        <div className="page-title-block">
          <p className="eyebrow">扬帆起航⛵️⛵️⛵️</p>
          <h1>
            <span>让每一笔记录沉成星图，</span>
            <span>指引下一次启程。</span>
          </h1>
          <p>把牌桌上的风声、筹码与心跳收进夜航图，等下一次灯亮时，仍知道该往哪里去。</p>
        </div>

        <form className="record-form" onSubmit={(event) => { event.preventDefault(); createRecord(); }}>
          <TextField label="比赛名称" value={draft.name} placeholder="请输入比赛名称" invalid={fieldErrors.name} onChange={(value) => updateDraft("name", value)} />
          <div className={`record-picker-field ${isTypeMenuOpen ? "is-open" : ""}`} ref={typePickerRef}>
            <span>类型</span>
            <button
              type="button"
              className="record-picker-trigger"
              aria-expanded={isTypeMenuOpen}
              onClick={() => {
                setIsDatePickerOpen(false);
                setIsCurrencyMenuOpen(false);
                setIsTypeMenuOpen((isOpen) => !isOpen);
              }}
            >
              <span>{draft.type}</span>
              <i aria-hidden="true" />
            </button>
            {isTypeMenuOpen ? (
              <div className="record-picker-menu record-type-menu">
                {recordTypes.map((type) => (
                  <button
                    type="button"
                    className={draft.type === type ? "active" : undefined}
                    key={type}
                    onClick={() => {
                      updateDraft("type", type);
                      setIsTypeMenuOpen(false);
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className={`record-picker-field record-date-field ${isDatePickerOpen ? "is-open" : ""}`} ref={datePickerRef}>
            <span>日期</span>
            <button
              type="button"
              className="record-picker-trigger"
              aria-expanded={isDatePickerOpen}
              onClick={toggleDatePicker}
            >
              <span>{draft.date} {draft.time}</span>
              <i aria-hidden="true" />
            </button>
            {isDatePickerOpen ? (
              <div className="record-picker-menu record-date-menu">
                <div className="record-calendar">
                  <div className="record-calendar-head">
                    <button
                      type="button"
                      aria-label="上个月"
                      onClick={() => setCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
                    >
                      ‹
                    </button>
                    <strong>{monthTitle(calendarMonth)}</strong>
                    <button
                      type="button"
                      aria-label="下个月"
                      onClick={() => setCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
                    >
                      ›
                    </button>
                  </div>
                  <div className="record-calendar-weekdays" aria-hidden="true">
                    {CALENDAR_WEEKDAYS.map((weekday) => (
                      <span key={weekday}>{weekday}</span>
                    ))}
                  </div>
                  <div className="record-calendar-grid">
                    {calendarDaysForMonth.map((day) => (
                      <button
                        type="button"
                        className={[
                          "record-date-day",
                          day.key === draft.date ? "active" : "",
                          day.isCurrentMonth ? "" : "is-outside",
                        ].filter(Boolean).join(" ")}
                        key={day.key}
                        onClick={() => selectCalendarDate(day.key)}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="record-time-picker">
                  <span>时间</span>
                  <div className="record-time-split" aria-label="时间">
                    <div className="record-time-segment" aria-label="小时">
                      <span>时</span>
                      <div className="record-time-wheel-shell">
                        <div
                          className="record-time-wheel record-time-part-wheel"
                          ref={draftHourWheelRef}
                          onScroll={(event) => handleDraftTimePartWheelScroll("hour", event)}
                          role="listbox"
                          aria-label="小时"
                        >
                          {HOUR_OPTIONS.map((hour) => (
                            <span
                              className={draftTimeParts.hour === hour ? "active" : undefined}
                              data-time-part={hour}
                              key={hour}
                              role="option"
                              aria-selected={draftTimeParts.hour === hour}
                            >
                              {hour}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="record-time-segment" aria-label="分钟">
                      <span>分</span>
                      <div className="record-time-wheel-shell">
                        <div
                          className="record-time-wheel record-time-part-wheel"
                          ref={draftMinuteWheelRef}
                          onScroll={(event) => handleDraftTimePartWheelScroll("minute", event)}
                          role="listbox"
                          aria-label="分钟"
                        >
                          {MINUTE_OPTIONS.map((minute) => (
                            <span
                              className={draftTimeParts.minute === minute ? "active" : undefined}
                              data-time-part={minute}
                              key={minute}
                              role="option"
                              aria-selected={draftTimeParts.minute === minute}
                            >
                              {minute}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <TextField label="买入" type="number" step="0.01" value={draft.amount} placeholder="0" invalid={fieldErrors.amount} onChange={(value) => updateDraft("amount", value)} />
          <TextField label="当前级别" type="number" value={draft.tableBb} placeholder="请输入当前大盲数量" invalid={fieldErrors.tableBb} onChange={(value) => updateDraft("tableBb", value)} />
          <div className={`record-picker-field ${isCurrencyMenuOpen ? "is-open" : ""}`} ref={currencyPickerRef}>
            <span>买入方式</span>
            <button
              type="button"
              className="record-picker-trigger"
              aria-expanded={isCurrencyMenuOpen}
              onClick={() => {
                setIsTypeMenuOpen(false);
                setIsDatePickerOpen(false);
                setIsCurrencyMenuOpen((isOpen) => !isOpen);
              }}
            >
              <span>{draft.buyInCurrency}</span>
              <i aria-hidden="true" />
            </button>
            {isCurrencyMenuOpen ? (
              <div className="record-picker-menu record-type-menu record-currency-menu">
                {BUY_IN_CURRENCIES.map((currency) => (
                  <button
                    type="button"
                    className={draft.buyInCurrency === currency ? "active" : undefined}
                    key={currency}
                    onClick={() => {
                      updateDraft("buyInCurrency", currency);
                      setIsCurrencyMenuOpen(false);
                    }}
                  >
                    {currency}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <label className="wide">
            <span>备注</span>
            <textarea value={draft.note} onChange={(event) => updateDraft("note", event.target.value)} placeholder="牌局脉络、关键手牌、节奏暗涌、心流余温" />
          </label>
          <button type="submit" disabled={isRecordsLoading || isRecordMutating}>
            {isRecordSaving ? "保存中" : "保存记录"}
          </button>
        </form>

        <article className="record-ledger">
          <div className="ledger-head">
            <strong>{signedMoney(current, 2)}</strong>
          </div>
          <div className={`record-scroll ${isRecordsLoading || hasRecordsError || !hasRecords ? "is-state" : ""}`}>
            {isRecordsLoading ? (
              <div className="record-state record-loading" role="status" aria-live="polite">
                <i aria-hidden="true" />
                <strong>读取记录中</strong>
                <span>正在同步远端牌局笔记</span>
              </div>
            ) : hasRecordsError ? (
              <div className="record-state record-error" role="status">
                <strong>记录同步失败</strong>
                <span>{recordsError}</span>
              </div>
            ) : !hasRecords ? (
              <div className="record-state record-empty">
                <strong>还没有记录</strong>
                <span>保存第一条比赛后，这里会开始滚动。</span>
              </div>
            ) : pageRecords.map((record) => {
              const result = recordDisplayResult(record);
              const status = recordListStatus(record, now);
              const type = recordType(record);
              const displayDateTime = recordDateTimeParts(record);
              const isOngoing = status === "进行中";
              const isNotStarted = status === "未开始";
              const statusClass = isNotStarted ? "is-not-started" : isOngoing ? "is-ongoing" : "is-ended";
              const shouldShowOngoingResult = isOngoing && isBountyRecordType(type);
              const ongoingBounty = record.event.bounty ?? 0;
              const durationText = status === "已结束" ? recordDurationText(record) : "";
              return (
                <div className={`record-row ${statusClass}`} key={record.event.id}>
                  <span className="record-status-rail" role="img" aria-label={`状态：${status}`} />
                  <button
                    type="button"
                    className="record-row-edit"
                    aria-label={`编辑 ${recordName(record)}`}
                    title="编辑"
                    disabled={isRecordMutating}
                    onClick={() => openEditRecord(record)}
                  >
                    <EditIcon />
                  </button>
                  <strong className="record-row-title">
                    <span>{recordName(record)}</span>
                    <small>{type}</small>
                  </strong>
                  <span className="record-row-meta">
                    <time dateTime={displayDateTime.dateTime}>
                      {displayDateTime.date} {displayDateTime.time}
                    </time>
                    {" "}
                    {weekdayText(displayDateTime.date)} / {record.event.tableBb}BB{durationText ? <> / {durationText}</> : null}
                  </span>
                  <div className="record-row-top">
                    {isNotStarted ? null : isOngoing ? (
                      shouldShowOngoingResult ? (
                        <b className={resultTone(ongoingBounty)}>{signedMoney(ongoingBounty, 2)}</b>
                      ) : null
                    ) : (
                      <b className={`record-result-final ${resultTone(result)}`}>{signedMoney(result, 2)}</b>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="record-pager" aria-label="记录分页">
            <span>{pagerRangeText}</span>
            <div>
              <button type="button" aria-label="上一页" disabled={isRecordsLoading || !hasRecords || currentPage === 1} onClick={() => setRecordPage(currentPage - 1)}>‹</button>
              <strong>{pagerPageText}</strong>
              <button type="button" aria-label="下一页" disabled={isRecordsLoading || !hasRecords || currentPage === pageCount} onClick={() => setRecordPage(currentPage + 1)}>›</button>
            </div>
          </div>
        </article>

        <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
      </section>
    </main>
    {editingRecord ? (
      <div
        className="record-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-edit-modal-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeEditRecord();
        }}
      >
        <form
          className="record-modal-form record-edit-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveEditRecord();
          }}
        >
          <div className="record-modal-head">
            <div>
              <strong id="record-edit-modal-title">编辑记录</strong>
              <small>{recordName(editingRecord)} / {recordType(editingRecord)}</small>
            </div>
            <button className="record-modal-close" type="button" aria-label="关闭" disabled={isEditSaving} onClick={closeEditRecord}>
              <span aria-hidden="true" />
            </button>
          </div>

          <div className="record-modal-fields record-edit-fields">
            <TextField label="比赛名称" value={editDraft.name} placeholder="请输入比赛名称" invalid={editFieldErrors.name} onChange={(value) => updateEditDraft("name", value)} />
            <div className={`record-picker-field ${isEditTypeMenuOpen ? "is-open" : ""}`} ref={editTypePickerRef}>
              <span>类型</span>
              <button
                type="button"
                className="record-picker-trigger"
                aria-expanded={isEditTypeMenuOpen}
                disabled={isEditSaving}
                onClick={() => {
                  setIsEditDatePickerOpen(false);
                  setIsEditCurrencyMenuOpen(false);
                  setIsEditTypeMenuOpen((isOpen) => !isOpen);
                }}
              >
                <span>{editDraft.type}</span>
                <i aria-hidden="true" />
              </button>
              {isEditTypeMenuOpen ? (
                <div className="record-picker-menu record-type-menu">
                  {recordTypes.map((type) => (
                    <button
                      type="button"
                      className={editDraft.type === type ? "active" : undefined}
                      key={type}
                      onClick={() => {
                        updateEditDraft("type", type);
                        setIsEditTypeMenuOpen(false);
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={`record-picker-field record-date-field record-edit-date-field ${isEditDatePickerOpen ? "is-open" : ""}`} ref={editDatePickerRef}>
              <span>日期</span>
              <button
                type="button"
                className="record-picker-trigger"
                aria-expanded={isEditDatePickerOpen}
                disabled={isEditSaving}
                onClick={toggleEditDatePicker}
              >
                <span>{editDraft.date} {editDraft.time}</span>
                <i aria-hidden="true" />
              </button>
              {isEditDatePickerOpen ? (
                <div className="record-picker-menu record-date-menu record-edit-date-menu">
                  <div className="record-calendar">
                    <div className="record-calendar-head">
                      <button
                        type="button"
                        aria-label="上个月"
                        onClick={() => setEditCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
                      >
                        ‹
                      </button>
                      <strong>{monthTitle(editCalendarMonth)}</strong>
                      <button
                        type="button"
                        aria-label="下个月"
                        onClick={() => setEditCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
                      >
                        ›
                      </button>
                    </div>
                    <div className="record-calendar-weekdays" aria-hidden="true">
                      {CALENDAR_WEEKDAYS.map((weekday) => (
                        <span key={weekday}>{weekday}</span>
                      ))}
                    </div>
                    <div className="record-calendar-grid">
                      {editCalendarDaysForMonth.map((day) => (
                        <button
                          type="button"
                          className={[
                            "record-date-day",
                            day.key === editDraft.date ? "active" : "",
                            day.isCurrentMonth ? "" : "is-outside",
                          ].filter(Boolean).join(" ")}
                          key={day.key}
                          onClick={() => selectEditCalendarDate(day.key)}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="record-time-picker">
                    <span>时间</span>
                    <div className="record-time-split" aria-label="时间">
                      <div className="record-time-segment" aria-label="小时">
                        <span>时</span>
                        <div className="record-time-wheel-shell">
                          <div
                            className="record-time-wheel record-time-part-wheel"
                            ref={editHourWheelRef}
                            onScroll={(event) => handleEditTimePartWheelScroll("hour", event)}
                            role="listbox"
                            aria-label="小时"
                          >
                            {HOUR_OPTIONS.map((hour) => (
                              <span
                                className={editTimeParts.hour === hour ? "active" : undefined}
                                data-time-part={hour}
                                key={hour}
                                role="option"
                                aria-selected={editTimeParts.hour === hour}
                              >
                                {hour}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="record-time-segment" aria-label="分钟">
                        <span>分</span>
                        <div className="record-time-wheel-shell">
                          <div
                            className="record-time-wheel record-time-part-wheel"
                            ref={editMinuteWheelRef}
                            onScroll={(event) => handleEditTimePartWheelScroll("minute", event)}
                            role="listbox"
                            aria-label="分钟"
                          >
                            {MINUTE_OPTIONS.map((minute) => (
                              <span
                                className={editTimeParts.minute === minute ? "active" : undefined}
                                data-time-part={minute}
                                key={minute}
                                role="option"
                                aria-selected={editTimeParts.minute === minute}
                              >
                                {minute}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <TextField label="买入" type="number" step="0.01" value={editDraft.amount} placeholder="0" invalid={editFieldErrors.amount} onChange={(value) => updateEditDraft("amount", value)} />
            <TextField label="当前级别" type="number" value={editDraft.tableBb} placeholder="请输入当前大盲数量" invalid={editFieldErrors.tableBb} onChange={(value) => updateEditDraft("tableBb", value)} />
            <div className={`record-picker-field ${isEditCurrencyMenuOpen ? "is-open" : ""}`} ref={editCurrencyPickerRef}>
              <span>买入方式</span>
              <button
                type="button"
                className="record-picker-trigger"
                aria-expanded={isEditCurrencyMenuOpen}
                disabled={isEditSaving}
                onClick={() => {
                  setIsEditTypeMenuOpen(false);
                  setIsEditDatePickerOpen(false);
                  setIsEditCurrencyMenuOpen((isOpen) => !isOpen);
                }}
              >
                <span>{editDraft.buyInCurrency}</span>
                <i aria-hidden="true" />
              </button>
              {isEditCurrencyMenuOpen ? (
                <div className="record-picker-menu record-type-menu record-currency-menu">
                  {BUY_IN_CURRENCIES.map((currency) => (
                    <button
                      type="button"
                      className={editDraft.buyInCurrency === currency ? "active" : undefined}
                      key={currency}
                      onClick={() => {
                        updateEditDraft("buyInCurrency", currency);
                        setIsEditCurrencyMenuOpen(false);
                      }}
                    >
                      {currency}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <label className="record-modal-full-field record-edit-note-field">
              <span>备注</span>
              <textarea value={editDraft.note} onChange={(event) => updateEditDraft("note", event.target.value)} placeholder="牌局脉络、关键手牌、节奏暗涌、心流余温" />
            </label>

            {isEditingOngoing ? (
              <>
                <div
                  className={[
                    "record-picker-field",
                    "record-settlement-time-field",
                    isSettlementTimePickerOpen ? "is-open" : "",
                  ].filter(Boolean).join(" ")}
                  ref={settlementTimePickerRef}
                >
                  <span>结束时间</span>
                  <button
                    type="button"
                    className="record-picker-trigger"
                    aria-expanded={isSettlementTimePickerOpen}
                    disabled={Boolean(settlementAction) || isEditSaving}
                    onClick={toggleSettlementTimePicker}
                  >
                    <span>
                      {settlementDraft.endDate && settlementDraft.endTime
                        ? `${settlementDraft.endDate} ${settlementDraft.endTime}`
                        : "请选择结束时间"}
                    </span>
                    <i aria-hidden="true" />
                  </button>
                  {isSettlementTimePickerOpen ? (
                    <div className="record-picker-menu record-date-menu record-settlement-time-menu">
                      <div className="record-calendar">
                        <div className="record-calendar-head">
                          <button
                            type="button"
                            aria-label="结束日期上个月"
                            onClick={() => setSettlementCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
                          >
                            ‹
                          </button>
                          <strong>{monthTitle(settlementCalendarMonth)}</strong>
                          <button
                            type="button"
                            aria-label="结束日期下个月"
                            onClick={() => setSettlementCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
                          >
                            ›
                          </button>
                        </div>
                        <div className="record-calendar-weekdays" aria-hidden="true">
                          {CALENDAR_WEEKDAYS.map((weekday) => (
                            <span key={weekday}>{weekday}</span>
                          ))}
                        </div>
                        <div className="record-calendar-grid">
                          {settlementCalendarDaysForMonth.map((day) => (
                            <button
                              type="button"
                              className={[
                                "record-date-day",
                                day.key === settlementDraft.endDate ? "active" : "",
                                day.isCurrentMonth ? "" : "is-outside",
                              ].filter(Boolean).join(" ")}
                              key={day.key}
                              onClick={() => selectSettlementCalendarDate(day.key)}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="record-time-picker">
                        <span>时间</span>
                        <div className="record-time-split" aria-label="结束时间">
                          <div className="record-time-segment" aria-label="结束小时">
                            <span>时</span>
                            <div className="record-time-wheel-shell">
                              <div
                                className="record-time-wheel record-time-part-wheel"
                                ref={settlementHourWheelRef}
                                onScroll={(event) => handleSettlementTimePartWheelScroll("hour", event)}
                                role="listbox"
                                aria-label="结束小时"
                              >
                                {HOUR_OPTIONS.map((hour) => (
                                  <span
                                    className={settlementTimeParts.hour === hour ? "active" : undefined}
                                    data-time-part={hour}
                                    key={hour}
                                    role="option"
                                    aria-selected={settlementTimeParts.hour === hour}
                                  >
                                    {hour}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="record-time-segment" aria-label="结束分钟">
                            <span>分</span>
                            <div className="record-time-wheel-shell">
                              <div
                                className="record-time-wheel record-time-part-wheel"
                                ref={settlementMinuteWheelRef}
                                onScroll={(event) => handleSettlementTimePartWheelScroll("minute", event)}
                                role="listbox"
                                aria-label="结束分钟"
                              >
                                {MINUTE_OPTIONS.map((minute) => (
                                  <span
                                    className={settlementTimeParts.minute === minute ? "active" : undefined}
                                    data-time-part={minute}
                                    key={minute}
                                    role="option"
                                    aria-selected={settlementTimeParts.minute === minute}
                                  >
                                    {minute}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div
                  className={[
                    "record-picker-field",
                    "record-money-status-field",
                    isMoneyStatusMenuOpen ? "is-open" : "",
                  ].filter(Boolean).join(" ")}
                  ref={moneyStatusPickerRef}
                >
                  <span>是否进入钱圈</span>
                  <button
                    type="button"
                    className="record-picker-trigger"
                    aria-expanded={isMoneyStatusMenuOpen}
                    disabled={Boolean(settlementAction) || isEditSaving}
                    onClick={toggleMoneyStatusMenu}
                  >
                    <span>{settlementDraft.inMoney}</span>
                    <i aria-hidden="true" />
                  </button>
                  {isMoneyStatusMenuOpen ? (
                    <div className="record-picker-menu record-type-menu record-money-status-menu">
                      {MONEY_STATUS_OPTIONS.map((status) => (
                        <button
                          type="button"
                          className={settlementDraft.inMoney === status ? "active" : undefined}
                          key={status}
                          onClick={() => selectMoneyStatus(status)}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {isEditSettlementBounty ? (
                  <label className="record-modal-full-field">
                    <span>新增赏金 {editSettlementCurrency}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={settlementDraft.bounty}
                      placeholder="0.00"
                      onChange={(event) => updateSettlementDraft("bounty", event.target.value)}
                    />
                  </label>
                ) : null}

                {isEditSettlementInMoney ? (
                  <div className="record-modal-payout-row">
                    <label>
                      <span>战绩 {editSettlementCurrency}</span>
                      <input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={settlementDraft.result}
                        placeholder="0"
                        onChange={(event) => updateSettlementDraft("result", event.target.value)}
                      />
                    </label>
                    <label className="record-modal-rank-field">
                      <span>名次</span>
                      <div className="record-rank-split">
                        <input
                          aria-label="实际名次"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={settlementDraft.rank}
                          placeholder="名次"
                          onChange={(event) => updateSettlementDraft("rank", event.target.value)}
                        />
                        <input
                          aria-label="实际人数"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={settlementDraft.fieldSize}
                          placeholder="人数"
                          onChange={(event) => updateSettlementDraft("fieldSize", event.target.value)}
                        />
                      </div>
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="record-modal-actions">
            {canDeleteEditingRecord ? (
              <button
                type="button"
                className="record-modal-delete-action"
                disabled={isEditSaving || Boolean(deletingRecordId)}
                onClick={() => deleteRecord(editingRecord, { mode: "delete" })}
              >
                {deletingRecordId === editingRecord.event.id ? "删除中" : "删除记录"}
              </button>
            ) : null}
            {isEditingNotStarted ? (
              <button
                type="button"
                className="secondary"
                disabled={isEditSaving || Boolean(deletingRecordId)}
                onClick={() => deleteRecord(editingRecord)}
              >
                {deletingRecordId === editingRecord.event.id ? "取消中" : "取消比赛"}
              </button>
            ) : null}
            {isEditingOngoing ? (
              <button
                type="button"
                className="secondary"
                disabled={!canFinishEditSettlement}
                onClick={() => saveSettlement({
                  record: editingRecord,
                  draft: settlementDraft,
                  usdCnyRate: settlementUsdCnyRate,
                  closeEditOnConfirmDialog: true,
                })}
              >
                {settlementAction === "finish" ? "结束中" : "结束比赛"}
              </button>
            ) : null}
            <button type="submit" disabled={isEditSaving}>
              {isEditSaving ? "保存中" : "保存修改"}
            </button>
          </div>
        </form>
      </div>
    ) : null}
    {confirmationDialog ? (
      <div
        className="record-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="record-confirm-title"
        aria-describedby="record-confirm-message"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeConfirmation();
        }}
      >
        <div className={`record-confirm-card is-${confirmationDialog.tone}`}>
          <div className="record-confirm-copy">
            <div className="record-confirm-heading">
              <div className="record-confirm-mark" aria-hidden="true">!</div>
              <strong id="record-confirm-title">{confirmationDialog.title}</strong>
            </div>
            <p id="record-confirm-message">{confirmationDialog.message}</p>
          </div>
          <div className="record-confirm-actions">
            <button
              type="button"
              className="secondary"
              disabled={isConfirmingAction}
              onClick={closeConfirmation}
            >
              {confirmationDialog.cancelLabel}
            </button>
            <button type="button" disabled={isConfirmingAction} onClick={confirmAction}>
              {isConfirmingAction ? "处理中" : confirmationDialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
