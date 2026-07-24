"use client";

import Image from "next/image";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  type ReviewHandSpot,
  type ReviewPlayerProfile,
  type ReviewStreet,
  type ReviewStreetAction,
  type ReviewStreetBetSize,
  type ReviewStreetPlayerStack,
} from "../lib/longgrind";

const HANDS_PER_PAGE = 8;
const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
type ReviewPlayerCount = (typeof PLAYER_COUNTS)[number];
type ReviewCreateStage = "hand" | "preflop" | "flop" | "turn" | "river";
type ActionStreet = Exclude<ReviewCreateStage, "hand">;
type PostflopStreet = Exclude<ReviewCreateStage, "hand" | "preflop">;
type PreflopActionKind = "fold" | "check" | "call" | "raise";
type PreflopIntent = "fold" | "commit";
type PreflopPlayerStatus = "active" | "folded" | "all-in";
type PostflopActionKind = "fold" | "check" | "call" | "bet" | "raise";
type PostflopIntent = "fold" | "check" | "commit";

type PreflopPlayerState = {
  committed: number;
  isHero: boolean;
  lastStackAfter: string;
  position: string;
  status: PreflopPlayerStatus;
};

type PreflopActionLog = {
  action: PreflopActionKind;
  addedBb: number;
  committedBb: number;
  currentBetBefore: number;
  id: string;
  position: string;
  potAfterBb: number;
  round: number;
  stackAfterBb?: number;
  stackBeforeBb?: number;
};

type PostflopPlayerState = {
  isHero: boolean;
  position: string;
  stackBb: number | null;
  status: PreflopPlayerStatus;
  streetCommitted: number;
};

type PostflopActionLog = {
  action: PostflopActionKind;
  addedBb: number;
  committedBb: number;
  currentBetBefore: number;
  id: string;
  position: string;
  potAfterBb: number;
  potBeforeBb: number;
  stackAfterBb?: number;
  stackBeforeBb?: number;
  street: PostflopStreet;
};

type PostflopStreetSnapshot = {
  actions: PostflopActionLog[];
  boardCards: string[];
  commitTo: string;
  currentBet: number;
  error: string;
  intent: PostflopIntent;
  lastRaiseSize: number;
  players: PostflopPlayerState[];
  potStart: number;
  queue: string[];
  stackBefore: string;
};

type ReviewsApiResponse = {
  reviews?: ReviewHandSpot[];
  etag?: string | null;
  error?: string;
};

type ReviewDraftConfirm = {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  onConfirm: () => void;
  title: string;
};

const REVIEWS_SNAPSHOT_DEDUPE_MS = 1000;

let reviewsSnapshotRequest: Promise<ReviewsApiResponse> | null = null;
let reviewsSnapshotCache: { data: ReviewsApiResponse; updatedAt: number } | null = null;

function requestReviewsSnapshot() {
  if (reviewsSnapshotCache && Date.now() - reviewsSnapshotCache.updatedAt < REVIEWS_SNAPSHOT_DEDUPE_MS) {
    return Promise.resolve(reviewsSnapshotCache.data);
  }

  reviewsSnapshotRequest ??= fetch("/api/reviews", { cache: "no-store" })
    .then(async (response) => {
      const data = (await response.json()) as ReviewsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "无法读取复盘");
      }

      reviewsSnapshotCache = {
        data,
        updatedAt: Date.now(),
      };
      return data;
    })
    .finally(() => {
      reviewsSnapshotRequest = null;
    });

  return reviewsSnapshotRequest;
}

type PreflopSnapshot = {
  actions: PreflopActionLog[];
  commitTo: string;
  currentBet: number;
  error: string;
  intent: PreflopIntent;
  lastRaiseSize: number;
  players: PreflopPlayerState[];
  queue: string[];
  round: number;
  stackBefore: string;
};

const POSITION_BY_PLAYER_COUNT: Record<ReviewPlayerCount, string[]> = {
  2: ["SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["LJ", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"] as const;
const CARD_SUITS = [
  { code: "s", label: "♠" },
  { code: "h", label: "♥" },
  { code: "c", label: "♣" },
  { code: "d", label: "♦" },
] as const;
const POSTFLOP_POSITION_ORDER = ["SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN"];
const POSTFLOP_HEADS_UP_ORDER = ["BB", "SB"];
const REVIEW_STAGE_LABELS: Record<ReviewCreateStage, string> = {
  hand: "选择手牌",
  preflop: "翻前行动",
  flop: "FLOP",
  turn: "TURN",
  river: "RIVER",
};
const BOARD_CARD_REQUIREMENT: Record<PostflopStreet, number> = {
  flop: 3,
  turn: 4,
  river: 5,
};
const POSTFLOP_STREET_ORDER: PostflopStreet[] = ["flop", "turn", "river"];
const NEXT_REVIEW_STAGE: Partial<Record<ReviewCreateStage, ReviewCreateStage>> = {
  hand: "preflop",
  preflop: "flop",
  flop: "turn",
  turn: "river",
};
const PREVIOUS_REVIEW_STAGE: Partial<Record<ReviewCreateStage, ReviewCreateStage>> = {
  flop: "preflop",
  turn: "flop",
  river: "turn",
};

function blindCommitmentForSmallBlind(position: string, smallBlindBb: number) {
  if (position === "SB") return smallBlindBb;
  if (position === "BB") return 1;
  return 0;
}

function createPreflopPlayers(
  playerCount: ReviewPlayerCount,
  heroPosition: string,
  smallBlindBb = 0.5,
): PreflopPlayerState[] {
  return POSITION_BY_PLAYER_COUNT[playerCount].map((position) => ({
    committed: blindCommitmentForSmallBlind(position, smallBlindBb),
    isHero: position === heroPosition,
    lastStackAfter: "",
    position,
    status: "active",
  }));
}

function positionsAfter(position: string, positions: string[]) {
  const index = positions.indexOf(position);
  if (index < 0) return positions;
  return [...positions.slice(index + 1), ...positions.slice(0, index)];
}

function activeActionQueue<T extends { position: string; status: PreflopPlayerStatus }>(queue: string[], players: T[]) {
  return queue.filter((position) => players.find((player) => player.position === position)?.status === "active");
}

function nextActivePosition<T extends { position: string; status: PreflopPlayerStatus }>(queue: string[], players: T[]) {
  return activeActionQueue(queue, players)[0] ?? null;
}

function livePreflopPlayerCount(players: PreflopPlayerState[]) {
  return players.filter((player) => player.status !== "folded").length;
}

function livePostflopPlayerCount(players: PostflopPlayerState[]) {
  return players.filter((player) => player.status !== "folded").length;
}

function preflopPot(players: PreflopPlayerState[], anteBb: number) {
  return players.reduce((total, player) => total + player.committed + anteBb, 0);
}

function postflopPot(players: PostflopPlayerState[], streetStartPotBb: number) {
  return players.reduce((total, player) => total + player.streetCommitted, streetStartPotBb);
}

function parseBbInput(value: string) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parseChipInput(value: string) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parseFilledBbInput(value: string) {
  if (!value.trim()) return null;
  return parseBbInput(value);
}

function parseFilledChipInput(value: string) {
  if (!value.trim()) return null;
  return parseChipInput(value);
}

function compactNumber(value: number, precision = 2) {
  const scale = 10 ** precision;
  const rounded = Math.round(value * scale) / scale;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(precision).replace(/\.?0+$/, "");
}

function bbInputValue(value: number) {
  return compactNumber(value);
}

function chipInputValue(value: number) {
  return compactNumber(value);
}

function roundBb(value: number) {
  return Math.round(value * 100) / 100;
}

function roundChips(value: number) {
  return Math.round(value * 100) / 100;
}

function chipAmountToBb(chipAmount: number | null, bigBlindChips: number) {
  if (chipAmount == null || bigBlindChips <= 0) return null;
  return roundBb(chipAmount / bigBlindChips);
}

function bbToChipAmount(valueBb: number, bigBlindChips: number) {
  return roundChips(valueBb * bigBlindChips);
}

function bbToChipInputValue(valueBb: number, bigBlindChips: number) {
  return chipInputValue(bbToChipAmount(valueBb, bigBlindChips));
}

function bbInputToChipInputValue(value: string, bigBlindChips: number) {
  const valueBb = parseFilledBbInput(value);
  return valueBb == null ? "" : bbToChipInputValue(valueBb, bigBlindChips);
}

function recommendedPreflopCommit(player: PreflopPlayerState | undefined, currentBet: number) {
  if (!player) return currentBet;
  if (currentBet <= 1) return Math.max(2, player.committed);
  return Math.max(currentBet, player.committed);
}

function minimumAggressiveCommit(currentBet: number, lastRaiseSize: number) {
  if (currentBet <= 0) return 1;
  return roundBb(currentBet + Math.max(1, lastRaiseSize));
}

function preflopForcedBeforeAction(player: PreflopPlayerState, anteBb: number, smallBlindBb = 0.5) {
  return player.lastStackAfter ? 0 : roundBb(anteBb + blindCommitmentForSmallBlind(player.position, smallBlindBb));
}

function preflopMaxCommitForStack(
  player: PreflopPlayerState,
  stackBeforeBb: number,
  anteBb: number,
  smallBlindBb = 0.5,
) {
  const availableForAction = Math.max(0, roundBb(stackBeforeBb - preflopForcedBeforeAction(player, anteBb, smallBlindBb)));
  return roundBb(player.committed + availableForAction);
}

function preflopDefaultCommitValue(
  player: PreflopPlayerState | undefined,
  currentBet: number,
  stackBeforeBb: number | null,
  anteBb: number,
  smallBlindBb = 0.5,
) {
  if (!player || stackBeforeBb == null) return "";

  const maxCommit = preflopMaxCommitForStack(player, stackBeforeBb, anteBb, smallBlindBb);
  if (maxCommit <= currentBet) return bbInputValue(maxCommit);
  return bbInputValue(Math.min(recommendedPreflopCommit(player, currentBet), maxCommit));
}

function preflopStackAfterForCommit(
  player: PreflopPlayerState,
  stackBeforeBb: number,
  commitToBb: number,
  anteBb: number,
  smallBlindBb = 0.5,
) {
  const addedBb = roundBb(commitToBb - player.committed);
  return roundBb(stackBeforeBb - preflopForcedBeforeAction(player, anteBb, smallBlindBb) - addedBb);
}

function recommendedPostflopCommit(
  player: PostflopPlayerState | undefined,
  currentBet: number,
  currentPotBb: number,
) {
  if (!player) return currentBet;
  if (currentBet > 0) return Math.max(currentBet, player.streetCommitted);
  return Math.max(1, roundBb(currentPotBb * 0.5), player.streetCommitted);
}

function postflopMaxCommitForStack(player: PostflopPlayerState, stackBeforeBb: number) {
  return roundBb(player.streetCommitted + stackBeforeBb);
}

function postflopDefaultCommitValue(
  player: PostflopPlayerState | undefined,
  currentBet: number,
  currentPotBb: number,
  stackBeforeBb: number | null,
) {
  if (!player || stackBeforeBb == null) return "";

  const maxCommit = postflopMaxCommitForStack(player, stackBeforeBb);
  if (currentBet > 0 && maxCommit <= currentBet) return bbInputValue(maxCommit);
  return bbInputValue(Math.min(recommendedPostflopCommit(player, currentBet, currentPotBb), maxCommit));
}

function createPostflopPlayers(preflopPlayers: PreflopPlayerState[]): PostflopPlayerState[] {
  return preflopPlayers
    .filter((player) => player.status !== "folded")
    .map((player) => ({
      isHero: player.isHero,
      position: player.position,
      stackBb: parseBbInput(player.lastStackAfter),
      status: player.status,
      streetCommitted: 0,
    }));
}

function resetStreetCommitted(players: PostflopPlayerState[]) {
  return players.map((player) => ({
    ...player,
    status: player.status === "folded" ? "folded" as const : player.stackBb === 0 ? "all-in" as const : "active" as const,
    streetCommitted: 0,
  }));
}

function postflopActionOrder(players: PostflopPlayerState[], playerCount: ReviewPlayerCount) {
  const activePositions = new Set(
    players.filter((player) => player.status === "active").map((player) => player.position),
  );
  const positionOrder = playerCount === 2 ? POSTFLOP_HEADS_UP_ORDER : POSTFLOP_POSITION_ORDER;

  return positionOrder.filter((position) => activePositions.has(position));
}

const suitCodes: Record<string, string> = {
  s: "s",
  h: "h",
  c: "c",
  d: "d",
  "♠": "s",
  "♥": "h",
  "♣": "c",
  "♦": "d",
};

function cardCode(card: string) {
  const trimmed = card.trim();
  if (!trimmed || trimmed === "-") return null;

  const rank = trimmed.slice(0, -1).toUpperCase().replace("10", "T");
  const suit = suitCodes[trimmed.slice(-1).toLowerCase()] ?? suitCodes[trimmed.slice(-1)];

  if (!/^[2-9TJQKA]$/.test(rank) || !suit) return null;
  return `${rank}${suit}`;
}

function cardLabel(card: string) {
  const code = cardCode(card);
  if (!code) return card;
  const suitLabels: Record<string, string> = {
    s: "♠",
    h: "♥",
    c: "♣",
    d: "♦",
  };

  return `${code.slice(0, -1)}${suitLabels[code.slice(-1)] ?? code.slice(-1)}`;
}

function cardLabelLine(cards: string[]) {
  return cards.map(cardLabel).join(" ");
}

function newReviewId() {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `review-${Date.now()}-${randomPart}`;
}

function cardCodes(value: string) {
  return value.split(/\s+/).map(cardCode).filter((code): code is string => Boolean(code));
}

function CardImages({
  value,
  variant = "default",
  label,
}: {
  value: string;
  variant?: "default" | "compact" | "board" | "street";
  label?: string;
}) {
  const cards = cardCodes(value);

  if (!cards.length) {
    return <span className={`playing-card-empty is-${variant}`}>-</span>;
  }

  return (
    <span className={`playing-card-stack is-${variant}`} aria-label={label ?? value}>
      {cards.map((code) => (
        <Image
          alt={code}
          className="playing-card-image"
          height={162}
          key={code}
          src={`/assets/cards/${code}.png`}
          width={122}
        />
      ))}
    </span>
  );
}

type ReviewStreetView = {
  actionLine: string;
  actions?: ReviewStreetAction[];
  betSizes?: ReviewStreetBetSize[];
  board: string;
  gtoThought: string;
  myThought: string;
  playerStacks: ReviewStreetPlayerStack[];
  potBb?: number;
  street: ReviewStreet["street"];
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBb(value: number) {
  return `${compactNumber(value)}BB`;
}

function formatChips(value: number) {
  return compactNumber(value);
}

function formatChipAmountWithBb(valueBb: number, bigBlindChips: number) {
  return `${formatChips(bbToChipAmount(valueBb, bigBlindChips))} (${formatBb(valueBb)})`;
}

function formatChipAmountWithBbFromString(value: string, bigBlindChips: number) {
  const valueBb = parseFilledBbInput(value);
  return valueBb == null ? "未记录" : formatChipAmountWithBb(valueBb, bigBlindChips);
}

function formatBetSize(betSize: ReviewStreetBetSize) {
  const percent = betSize.potBb > 0 ? Math.round((betSize.amountBb / betSize.potBb) * 100) : 0;
  if (typeof betSize.amountChips === "number") {
    return `${formatChips(betSize.amountChips)} (${formatBb(betSize.amountBb)}, ${percent}%)`;
  }
  return `${formatBb(betSize.amountBb)}(${percent}%)`;
}

function formatReviewStreetAction(action: ReviewStreetAction) {
  const formatActionAmount = (valueBb: number | undefined, valueChips: number | undefined) => {
    if (valueBb === undefined) return "";

    const shouldShowPercent = action.action === "bet" || action.action === "raise" || action.action === "jam";
    const percent = shouldShowPercent && action.potBeforeBb && action.potBeforeBb > 0
      ? Math.round((valueBb / action.potBeforeBb) * 100)
      : null;
    const amountLabel = valueChips === undefined
      ? formatBb(valueBb)
      : `${formatChips(valueChips)} (${formatBb(valueBb)}${percent == null ? "" : `, ${percent}%`})`;

    return ` ${amountLabel}`;
  };

  const amountLabel = formatActionAmount(action.amountBb, action.amountChips);
  const allInLabel = action.isAllIn ? " all-in" : "";

  if (action.action === "fold" || action.action === "check") {
    return `${action.position} ${action.action}`;
  }

  return `${action.position} ${action.action}${amountLabel}${allInLabel}`;
}

function formatPreflopAction(action: PreflopActionLog, bigBlindChips?: number) {
  const formatAmount = (valueBb: number) =>
    bigBlindChips ? formatChipAmountWithBb(valueBb, bigBlindChips) : formatBb(valueBb);

  if (action.action === "fold") return `${action.position} fold`;
  if (action.action === "check") return `${action.position} check`;
  if (action.action === "call") return `${action.position} call ${formatAmount(action.addedBb)}`;

  const raiseLabel = action.currentBetBefore <= 1 ? "open" : "raise";
  return `${action.position} ${raiseLabel} ${formatAmount(action.committedBb)}`;
}

function formatPostflopAction(action: PostflopActionLog, bigBlindChips?: number) {
  const formatAmount = (valueBb: number) =>
    bigBlindChips ? formatChipAmountWithBb(valueBb, bigBlindChips) : formatBb(valueBb);

  if (action.action === "fold") return `${action.position} fold`;
  if (action.action === "check") return `${action.position} check`;
  if (action.action === "call") return `${action.position} call ${formatAmount(action.addedBb)}`;

  const displayAmountBb = action.action === "raise" ? action.committedBb : action.addedBb;
  const percent = action.potBeforeBb > 0 ? Math.round((displayAmountBb / action.potBeforeBb) * 100) : 0;
  const amountLabel = bigBlindChips
    ? `${formatChips(bbToChipAmount(displayAmountBb, bigBlindChips))} (${formatBb(displayAmountBb)}, ${percent}%)`
    : `${formatBb(displayAmountBb)}(${percent}%)`;
  return `${action.position} ${action.action} ${amountLabel}`;
}

function hidePreflopFoldActions(actionLine: string) {
  if (!actionLine || actionLine === "未记录") return "未记录";

  const visibleActions = actionLine
    .split(/\s*,\s*/)
    .filter((action) => !/\bfold\b/i.test(action));

  return visibleActions.length ? visibleActions.join(", ") : "未记录";
}

function hidePreflopFoldStacks(playerStacks: ReviewStreetPlayerStack[]) {
  return playerStacks.filter((player) => !/^fold$/i.test(player.stack));
}

function hidePreflopFoldReviewActions(actions: ReviewStreetAction[] | undefined) {
  return actions?.filter((action) => action.action !== "fold");
}

function highlightHeroPosition(text: string, heroPosition: string | undefined, keyPrefix: string) {
  if (!heroPosition) return [text];

  const heroPositionPattern = new RegExp(`\\b(${escapeRegExp(heroPosition)})\\b`, "g");
  const actionParts = text.split(heroPositionPattern);

  return actionParts.map((part, index) =>
    part === heroPosition ? (
      <span className="review-action-position is-hero" key={`${keyPrefix}-${part}-${index}`}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function splitActionLine(actionLine: string) {
  const actions: string[] = [];
  let depth = 0;
  let startIndex = 0;

  for (let index = 0; index < actionLine.length; index += 1) {
    const character = actionLine[index];

    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);

    if ((character === "," || character === "，") && depth === 0) {
      const action = actionLine.slice(startIndex, index).trim();
      if (action) actions.push(action);
      startIndex = index + 1;
    }
  }

  const finalAction = actionLine.slice(startIndex).trim();
  if (finalAction) actions.push(finalAction);
  return actions;
}

function HighlightedActionLine({
  actionLine,
  betSizes = [],
  heroPosition,
}: {
  actionLine: string;
  betSizes?: ReviewStreetBetSize[];
  heroPosition?: string;
}) {
  const actionSizePattern = /\b(bet|raise|jam)\b(?:\s+(?:[^,()]|\([^)]*\))+)*/g;
  const renderedParts: Array<string | ReactElement> = [];
  let lastIndex = 0;
  let betSizeIndex = 0;

  for (const match of actionLine.matchAll(actionSizePattern)) {
    const matchIndex = match.index ?? 0;
    const textBefore = actionLine.slice(lastIndex, matchIndex);

    renderedParts.push(...highlightHeroPosition(textBefore, heroPosition, `text-${matchIndex}`));

    const betSize = betSizes[betSizeIndex];
    if (betSize) {
      renderedParts.push(`${match[1]} ${formatBetSize(betSize)}`);
      betSizeIndex += 1;
    } else {
      renderedParts.push(...highlightHeroPosition(match[0], heroPosition, `action-${matchIndex}`));
    }

    lastIndex = matchIndex + match[0].length;
  }

  renderedParts.push(...highlightHeroPosition(actionLine.slice(lastIndex), heroPosition, "text-tail"));

  return renderedParts;
}

function ActionLineSteps({
  actionLine,
  actions,
  betSizes = [],
  heroPosition,
}: {
  actionLine: string;
  actions?: ReviewStreetAction[];
  betSizes?: ReviewStreetBetSize[];
  heroPosition?: string;
}) {
  const fallbackActions = splitActionLine(actionLine);
  const sizedActionCounts = fallbackActions.map((action) => [...action.matchAll(/\b(bet|raise|jam)\b/g)].length);

  if (actions?.length) {
    return (
      <ol className="review-action-steps" aria-label="行动序列">
        {actions.map((action, index) => (
          <li key={`${action.position}-${action.action}-${index}`}>
            <span className="review-action-step-number">{index + 1}</span>
            <strong>{highlightHeroPosition(formatReviewStreetAction(action), heroPosition, `structured-${index}`)}</strong>
          </li>
        ))}
      </ol>
    );
  }

  if (!fallbackActions.length || actionLine === "未记录" || actionLine === "未发生") {
    return <span className="review-action-empty">{actionLine === "未发生" ? "未发生" : "未记录"}</span>;
  }

  return (
    <ol className="review-action-steps" aria-label="行动序列">
      {fallbackActions.map((action, index) => {
        const betSizeStart = sizedActionCounts
          .slice(0, index)
          .reduce((total, sizedActionCount) => total + sizedActionCount, 0);
        const actionBetSizes = betSizes.slice(betSizeStart, betSizeStart + sizedActionCounts[index]);

        return (
          <li key={`${action}-${index}`}>
            <span className="review-action-step-number">{index + 1}</span>
            <strong>
              <HighlightedActionLine actionLine={action} betSizes={actionBetSizes} heroPosition={heroPosition} />
            </strong>
          </li>
        );
      })}
    </ol>
  );
}

function StreetReviewCard({
  street,
  editingGtoStreet,
  gtoDraft,
  isGtoSaving,
  isReviewMutating,
  onCancelGtoEdit,
  onChangeGtoDraft,
  onSaveGtoThought,
  onStartGtoEdit,
}: {
  street: ReviewStreetView;
  editingGtoStreet: ReviewStreet["street"] | "";
  gtoDraft: string;
  isGtoSaving: boolean;
  isReviewMutating: boolean;
  onCancelGtoEdit: () => void;
  onChangeGtoDraft: (value: string) => void;
  onSaveGtoThought: (streetName: ReviewStreet["street"]) => void;
  onStartGtoEdit: (streetName: ReviewStreet["street"], currentThought: string) => void;
}) {
  const isUnplayedStreet = street.actionLine === "未发生" && !street.actions?.length;
  const playerStacks = isUnplayedStreet
    ? []
    : street.playerStacks?.length
      ? street.playerStacks
      : [{ position: "在池", stack: "未记录" }];
  const visiblePlayerStacks = street.street === "Preflop"
    ? hidePreflopFoldStacks(playerStacks)
    : playerStacks;
  const heroPosition = visiblePlayerStacks.find((player) => player.isHero)?.position;
  const potBb = street.potBb ?? street.betSizes?.[0]?.potBb;
  const actionLine = street.street === "Preflop"
    ? hidePreflopFoldActions(street.actionLine)
    : street.actionLine;
  const reviewActions = street.street === "Preflop"
    ? hidePreflopFoldReviewActions(street.actions)
    : street.actions;
  const isEditingGto = editingGtoStreet === street.street;
  const isPlaceholderGto = street.gtoThought === "待补充" || street.gtoThought === "未记录";

  return (
    <article>
      <div className="review-action-line">
        <span className="review-street-name">{street.street}</span>
        <ActionLineSteps
          actionLine={actionLine}
          actions={reviewActions}
          betSizes={street.betSizes}
          heroPosition={heroPosition}
        />
        {isUnplayedStreet ? null : (
          <div className="review-pot-stacks" aria-label="在池筹码">
            <ul>
              {visiblePlayerStacks.map((player, index) => (
                <li className={player.isHero ? "is-hero" : undefined} key={`${player.position}-${index}`}>
                  <em>{player.position}</em>
                  <b>{player.stack}</b>
                </li>
              ))}
              {typeof potBb === "number" && (
                <li className="is-pot">
                  <em>POT</em>
                  <b>{formatBb(potBb)}</b>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="review-thought-compare">
        <section>
          <div className="review-thought-head">
            <span>我的想法</span>
          </div>
          <p>{street.myThought}</p>
        </section>
        <section>
          <div className="review-thought-head">
            <span>GTO 想法</span>
            <div className="review-thought-actions">
              {isEditingGto ? (
                <>
                  <button
                    aria-label="取消编辑 GTO 想法"
                    disabled={isGtoSaving}
                    title="取消"
                    type="button"
                    onClick={onCancelGtoEdit}
                  >
                    <XIcon />
                  </button>
                  <button
                    aria-label={isGtoSaving ? "正在保存 GTO 想法" : "保存 GTO 想法"}
                    disabled={isGtoSaving}
                    title={isGtoSaving ? "保存中" : "保存"}
                    type="button"
                    onClick={() => onSaveGtoThought(street.street)}
                  >
                    <CheckIcon />
                  </button>
                </>
              ) : (
                <button
                  aria-label={`编辑 ${street.street} GTO 想法`}
                  disabled={isReviewMutating}
                  title="编辑"
                  type="button"
                  onClick={() => onStartGtoEdit(street.street, street.gtoThought)}
                >
                  <PencilIcon />
                </button>
              )}
            </div>
          </div>
          {isEditingGto ? (
            <textarea
              aria-label={`${street.street} GTO 想法`}
              className="review-gto-textarea"
              disabled={isGtoSaving}
              value={gtoDraft}
              onChange={(event) => onChangeGtoDraft(event.target.value)}
            />
          ) : (
            <p className={isPlaceholderGto ? "is-placeholder" : undefined}>{street.gtoThought}</p>
          )}
        </section>
      </div>
    </article>
  );
}

function PlayerProfileStrip({ profiles }: { profiles: ReviewPlayerProfile[] }) {
  if (!profiles.length) return null;

  return (
    <div className="review-player-profiles" aria-label="玩家画像">
      {profiles.map((playerProfile) => (
        <article key={`${playerProfile.position}-${playerProfile.profile}`}>
          <strong>{playerProfile.position}</strong>
          <span>{playerProfile.profile}</span>
        </article>
      ))}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m6 6 1 15h10l1-15" />
      <path d="M10 10v7" />
      <path d="M14 10v7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20H4v-4L16.5 3.5Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default function ReviewPage() {
  const preflopLogRef = useRef<HTMLOListElement | null>(null);
  const postflopLogRef = useRef<HTMLOListElement | null>(null);
  const [reviews, setReviews] = useState<ReviewHandSpot[]>([]);
  const [reviewsEtag, setReviewsEtag] = useState<string | null>(null);
  const [reviewsError, setReviewsError] = useState("");
  const [isReviewsLoading, setIsReviewsLoading] = useState(true);
  const [isReviewSaving, setIsReviewSaving] = useState(false);
  const [deletingReviewId, setDeletingReviewId] = useState("");
  const [editingGtoStreet, setEditingGtoStreet] = useState<ReviewStreet["street"] | "">("");
  const [gtoDraft, setGtoDraft] = useState("");
  const [savingGtoStreet, setSavingGtoStreet] = useState<ReviewStreet["street"] | "">("");
  const [toast, setToast] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [handPage, setHandPage] = useState(1);
  const [isReviewCreateOpen, setIsReviewCreateOpen] = useState(false);
  const [reviewDraftConfirm, setReviewDraftConfirm] = useState<ReviewDraftConfirm | null>(null);
  const [reviewDeleteTarget, setReviewDeleteTarget] = useState<ReviewHandSpot | null>(null);
  const [reviewCreateStage, setReviewCreateStage] = useState<ReviewCreateStage>("hand");
  const [heroCards, setHeroCards] = useState<string[]>([]);
  const [heroHandError, setHeroHandError] = useState("");
  const [reviewPlayerCount, setReviewPlayerCount] = useState<ReviewPlayerCount>(8);
  const [reviewHeroPosition, setReviewHeroPosition] = useState("");
  const [preflopPlayers, setPreflopPlayers] = useState<PreflopPlayerState[]>(() =>
    createPreflopPlayers(8, ""),
  );
  const [preflopQueue, setPreflopQueue] = useState<string[]>(() => [...POSITION_BY_PLAYER_COUNT[8]]);
  const [preflopCurrentBet, setPreflopCurrentBet] = useState(1);
  const [preflopLastRaiseSize, setPreflopLastRaiseSize] = useState(1);
  const [preflopRound, setPreflopRound] = useState(1);
  const [preflopActions, setPreflopActions] = useState<PreflopActionLog[]>([]);
  const [preflopHistory, setPreflopHistory] = useState<PreflopSnapshot[]>([]);
  const [preflopSmallBlindChips, setPreflopSmallBlindChips] = useState("500");
  const [preflopBigBlindChips, setPreflopBigBlindChips] = useState("1000");
  const [preflopAnteChips, setPreflopAnteChips] = useState("0");
  const [preflopIntent, setPreflopIntent] = useState<PreflopIntent>("fold");
  const [preflopCommitTo, setPreflopCommitTo] = useState("2000");
  const [preflopStackBefore, setPreflopStackBefore] = useState("");
  const [preflopError, setPreflopError] = useState("");
  const [boardCards, setBoardCards] = useState<string[]>([]);
  const [postflopPlayers, setPostflopPlayers] = useState<PostflopPlayerState[]>([]);
  const [postflopQueue, setPostflopQueue] = useState<string[]>([]);
  const [postflopPotStart, setPostflopPotStart] = useState(0);
  const [postflopCurrentBet, setPostflopCurrentBet] = useState(0);
  const [postflopLastRaiseSize, setPostflopLastRaiseSize] = useState(1);
  const [postflopActions, setPostflopActions] = useState<PostflopActionLog[]>([]);
  const [postflopIntent, setPostflopIntent] = useState<PostflopIntent>("check");
  const [postflopCommitTo, setPostflopCommitTo] = useState("1000");
  const [postflopStackBefore, setPostflopStackBefore] = useState("");
  const [postflopError, setPostflopError] = useState("");
  const [postflopStreetSnapshots, setPostflopStreetSnapshots] = useState<Partial<Record<PostflopStreet, PostflopStreetSnapshot>>>({});
  const [draftPlayerProfiles, setDraftPlayerProfiles] = useState<Record<string, string>>({});
  const [draftStreetThoughts, setDraftStreetThoughts] = useState<Partial<Record<ActionStreet, string>>>({});

  const isReviewModalOpen = isReviewCreateOpen || Boolean(reviewDeleteTarget) || Boolean(reviewDraftConfirm);
  const hasReviewDraftProgress = isReviewCreateOpen && (
    heroCards.length > 0 ||
    reviewCreateStage !== "hand" ||
    preflopActions.length > 0 ||
    preflopHistory.length > 0 ||
    boardCards.length > 0 ||
    postflopActions.length > 0 ||
    Object.keys(postflopStreetSnapshots).length > 0 ||
    Object.values(draftPlayerProfiles).some((profile) => profile.trim()) ||
    Object.values(draftStreetThoughts).some((thought) => thought?.trim())
  );
  const hasActionDraftProgress = isReviewCreateOpen && (
    reviewCreateStage !== "hand" ||
    preflopActions.length > 0 ||
    preflopHistory.length > 0 ||
    boardCards.length > 0 ||
    postflopActions.length > 0 ||
    Object.keys(postflopStreetSnapshots).length > 0 ||
    Object.values(draftPlayerProfiles).some((profile) => profile.trim()) ||
    Object.values(draftStreetThoughts).some((thought) => thought?.trim())
  );

  useEffect(() => {
    if (!isReviewModalOpen) return;

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
  }, [isReviewModalOpen]);

  useEffect(() => {
    let isActive = true;

    async function loadReviews() {
      setIsReviewsLoading(true);
      setReviewsError("");

      try {
        const data = await requestReviewsSnapshot();

        if (!isActive) return;
        setReviews(data.reviews ?? []);
        setReviewsEtag(data.etag ?? null);
      } catch (error) {
        if (!isActive) return;
        setReviews([]);
        setReviewsEtag(null);
        setReviewsError(error instanceof Error ? error.message : "无法读取复盘");
        setToast("复盘同步失败");
      } finally {
        if (isActive) setIsReviewsLoading(false);
      }
    }

    loadReviews();

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
    if (!hasReviewDraftProgress) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasReviewDraftProgress]);

  const hasReviews = reviews.length > 0;
  const hasReviewsError = Boolean(reviewsError);
  const isReviewMutating = isReviewSaving || Boolean(deletingReviewId) || Boolean(savingGtoStreet);
  const pageCount = Math.max(1, Math.ceil(reviews.length / HANDS_PER_PAGE));
  const currentPage = Math.min(handPage, pageCount);
  const pageStart = (currentPage - 1) * HANDS_PER_PAGE;
  const pageHands = reviews.slice(pageStart, pageStart + HANDS_PER_PAGE);
  const selectedHand = reviews.find((hand) => hand.id === selectedId) ?? pageHands[0] ?? null;
  const reviewPositions = POSITION_BY_PLAYER_COUNT[reviewPlayerCount];
  const hasReviewHeroPosition = reviewPositions.includes(reviewHeroPosition);
  const activePreflopQueue = activeActionQueue(preflopQueue, preflopPlayers);
  const currentPreflopPosition = activePreflopQueue[0] ?? null;
  const currentPreflopPlayer = currentPreflopPosition
    ? preflopPlayers.find((player) => player.position === currentPreflopPosition)
    : undefined;
  const preflopBigBlindChipsValue = parseFilledChipInput(preflopBigBlindChips);
  const activeBigBlindChips = preflopBigBlindChipsValue && preflopBigBlindChipsValue > 0 ? preflopBigBlindChipsValue : 1;
  const preflopSmallBlindChipsValue = parseFilledChipInput(preflopSmallBlindChips) ?? 0;
  const preflopAnteChipsValue = parseFilledChipInput(preflopAnteChips) ?? 0;
  const preflopSmallBlindBb = chipAmountToBb(preflopSmallBlindChipsValue, activeBigBlindChips) ?? 0;
  const preflopAnteBb = chipAmountToBb(preflopAnteChipsValue, activeBigBlindChips) ?? 0;
  const preflopPotBb = preflopPot(preflopPlayers, preflopAnteBb);
  const preflopMinimumRaiseCommit = minimumAggressiveCommit(preflopCurrentBet, preflopLastRaiseSize);
  const preflopMinimumCommit = currentPreflopPlayer
    ? Math.max(preflopCurrentBet, currentPreflopPlayer.committed)
    : preflopCurrentBet;
  const preflopCallNeeded = currentPreflopPlayer
    ? Math.max(0, preflopCurrentBet - currentPreflopPlayer.committed)
    : 0;
  const preflopStackBeforeValue = chipAmountToBb(parseFilledChipInput(preflopStackBefore), activeBigBlindChips);
  const preflopMaxCommitTo = currentPreflopPlayer && preflopStackBeforeValue != null
    ? preflopMaxCommitForStack(currentPreflopPlayer, preflopStackBeforeValue, preflopAnteBb, preflopSmallBlindBb)
    : null;
  const isPreflopCoveredAllIn = preflopMaxCommitTo != null && preflopMaxCommitTo <= preflopCurrentBet;
  const preflopEffectiveMinimumCommit = preflopMaxCommitTo == null
    ? preflopMinimumCommit
    : Math.min(preflopMinimumCommit, preflopMaxCommitTo);
  const isPreflopCommitInputDisabled = preflopStackBeforeValue == null || isPreflopCoveredAllIn;
  const preflopCommitToInputValue = preflopStackBeforeValue == null
    ? ""
    : isPreflopCoveredAllIn && preflopMaxCommitTo != null
      ? bbToChipInputValue(preflopMaxCommitTo, activeBigBlindChips)
      : preflopCommitTo;
  const canPreflopAllIn = preflopStackBeforeValue != null && preflopStackBeforeValue > 0 && preflopMaxCommitTo != null;
  const preflopCommitToValue = chipAmountToBb(parseFilledChipInput(preflopCommitToInputValue), activeBigBlindChips);
  const currentPostflopStreet: PostflopStreet =
    reviewCreateStage === "flop" || reviewCreateStage === "turn" || reviewCreateStage === "river"
      ? reviewCreateStage
      : "flop";
  const requiredBoardCardCount = BOARD_CARD_REQUIREMENT[currentPostflopStreet];
  const postflopBoardComplete = boardCards.length >= requiredBoardCardCount;
  const flopBoardValue = boardCards.slice(0, 3).join(" ") || "-";
  const turnBoardValue = boardCards[3] ?? "-";
  const riverBoardValue = boardCards[4] ?? "-";
  const activePostflopQueue = activeActionQueue(postflopQueue, postflopPlayers);
  const currentPostflopPosition = activePostflopQueue[0] ?? null;
  const currentPostflopPlayer = currentPostflopPosition
    ? postflopPlayers.find((player) => player.position === currentPostflopPosition)
    : undefined;
  const postflopPotBb = postflopPot(postflopPlayers, postflopPotStart);
  const postflopMinimumRaiseCommit = minimumAggressiveCommit(postflopCurrentBet, postflopLastRaiseSize);
  const postflopCallNeeded = currentPostflopPlayer
    ? Math.max(0, postflopCurrentBet - currentPostflopPlayer.streetCommitted)
    : 0;
  const postflopMinimumCommit = currentPostflopPlayer
    ? postflopCurrentBet > 0
      ? Math.max(postflopCurrentBet, currentPostflopPlayer.streetCommitted)
      : Math.max(1, currentPostflopPlayer.streetCommitted)
    : postflopCurrentBet;
  const postflopStackBeforeValue = chipAmountToBb(parseFilledChipInput(postflopStackBefore), activeBigBlindChips);
  const postflopMaxCommitTo = currentPostflopPlayer && postflopStackBeforeValue != null
    ? postflopMaxCommitForStack(currentPostflopPlayer, postflopStackBeforeValue)
    : null;
  const isPostflopCoveredAllIn = postflopCurrentBet > 0 && postflopMaxCommitTo != null && postflopMaxCommitTo <= postflopCurrentBet;
  const postflopEffectiveMinimumCommit = postflopMaxCommitTo == null
    ? postflopMinimumCommit
    : Math.min(postflopMinimumCommit, postflopMaxCommitTo);
  const isPostflopCommitInputDisabled = postflopStackBeforeValue == null || isPostflopCoveredAllIn;
  const postflopCommitToInputValue = postflopStackBeforeValue == null
    ? ""
    : isPostflopCoveredAllIn && postflopMaxCommitTo != null
      ? bbToChipInputValue(postflopMaxCommitTo, activeBigBlindChips)
      : postflopCommitTo;
  const canPostflopAllIn = postflopStackBeforeValue != null && postflopStackBeforeValue > 0 && postflopMaxCommitTo != null;
  const postflopCommitToValue = chipAmountToBb(parseFilledChipInput(postflopCommitToInputValue), activeBigBlindChips);
  const nextReviewStage = NEXT_REVIEW_STAGE[reviewCreateStage];
  const isPostflopStage = reviewCreateStage === "flop" || reviewCreateStage === "turn" || reviewCreateStage === "river";
  const isPreflopHandEnded = reviewCreateStage === "preflop" && !currentPreflopPosition && livePreflopPlayerCount(preflopPlayers) < 2;
  const isPostflopStageComplete = isPostflopStage && postflopBoardComplete && !currentPostflopPosition;
  const isPostflopHandEnded = isPostflopStageComplete && livePostflopPlayerCount(postflopPlayers) < 2;
  const shouldSaveReviewNow = isPreflopHandEnded || (isPostflopStageComplete && (!nextReviewStage || isPostflopHandEnded));
  const nextReviewStageLabel = shouldSaveReviewNow
    ? "保存手牌"
    : nextReviewStage
      ? `进入${REVIEW_STAGE_LABELS[nextReviewStage]}`
      : "添加手牌";
  const previousReviewStage = PREVIOUS_REVIEW_STAGE[reviewCreateStage];
  const previousReviewStageLabel = previousReviewStage === "preflop"
    ? "返回PREFLOP"
    : previousReviewStage
      ? `返回${REVIEW_STAGE_LABELS[previousReviewStage]}`
      : "返回PREFLOP";

  useEffect(() => {
    const log = preflopLogRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [preflopActions.length, preflopPotBb]);

  useEffect(() => {
    const log = postflopLogRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [postflopActions.length, postflopPotBb]);

  function resetActionDraft(
    nextPlayerCount = reviewPlayerCount,
    nextHeroPosition = reviewHeroPosition,
    nextSmallBlindBb = preflopSmallBlindBb,
  ) {
    setPreflopPlayers(createPreflopPlayers(nextPlayerCount, nextHeroPosition, nextSmallBlindBb));
    setPreflopQueue([...POSITION_BY_PLAYER_COUNT[nextPlayerCount]]);
    setPreflopCurrentBet(1);
    setPreflopLastRaiseSize(1);
    setPreflopRound(1);
    setPreflopActions([]);
    setPreflopHistory([]);
    setPreflopIntent("fold");
    setPreflopCommitTo("");
    setPreflopStackBefore("");
    setPreflopError("");
    setBoardCards([]);
    setPostflopPlayers([]);
    setPostflopQueue([]);
    setPostflopPotStart(0);
    setPostflopCurrentBet(0);
    setPostflopLastRaiseSize(1);
    setPostflopActions([]);
    setPostflopIntent("check");
    setPostflopCommitTo(bbToChipInputValue(1, activeBigBlindChips));
    setPostflopStackBefore("");
    setPostflopError("");
    setPostflopStreetSnapshots({});
    setDraftPlayerProfiles({});
    setDraftStreetThoughts({});
  }

  function requestReviewDraftConfirm({
    cancelLabel = "继续录入",
    confirmLabel = "确认放弃",
    message,
    onConfirm,
    shouldConfirm = hasReviewDraftProgress,
    title = "放弃当前录入？",
  }: Partial<Pick<ReviewDraftConfirm, "cancelLabel" | "confirmLabel" | "title">> & {
    message: string;
    onConfirm: () => void;
    shouldConfirm?: boolean;
  }) {
    if (!shouldConfirm) {
      onConfirm();
      return;
    }

    setReviewDraftConfirm({
      cancelLabel,
      confirmLabel,
      message,
      onConfirm,
      title,
    });
  }

  function closeReviewDraftConfirm() {
    setReviewDraftConfirm(null);
  }

  function confirmReviewDraftAction() {
    if (!reviewDraftConfirm) return;

    const { onConfirm } = reviewDraftConfirm;
    setReviewDraftConfirm(null);
    onConfirm();
  }

  function closeReviewCreateModal() {
    if (isReviewSaving) return;

    requestReviewDraftConfirm({
      confirmLabel: "确认关闭",
      message: "当前手牌还没有保存，关闭后会丢失这些录入。",
      onConfirm: () => setIsReviewCreateOpen(false),
      title: "关闭新增手牌？",
    });
  }

  function resetPreflop(
    nextPlayerCount = reviewPlayerCount,
    nextHeroPosition = reviewHeroPosition,
    nextSmallBlindBb = preflopSmallBlindBb,
  ) {
    setReviewCreateStage("preflop");
    resetActionDraft(nextPlayerCount, nextHeroPosition, nextSmallBlindBb);
  }

  function resetPreflopWithConfirm() {
    requestReviewDraftConfirm({
      confirmLabel: "确认重置",
      message: "重置会清空当前手牌的所有行动。",
      onConfirm: () => resetPreflop(),
      title: "重置 Preflop？",
    });
  }

  function restartHeroHandSelection() {
    requestReviewDraftConfirm({
      confirmLabel: "重新选择",
      message: "重新选择手牌会清空当前录入。",
      onConfirm: () => {
        setReviewCreateStage("hand");
        setHeroCards([]);
        setHeroHandError("");
        resetActionDraft();
      },
      title: "重新选择手牌？",
    });
  }

  function selectHeroCard(card: string) {
    if (reviewCreateStage !== "hand") return;

    setHeroCards((cards) => {
      if (cards.includes(card)) return cards.filter((currentCard) => currentCard !== card);
      if (cards.length >= 2) return cards;
      return [...cards, card];
    });
    setHeroHandError("");
  }

  function actionNoteValue(player: { isHero: boolean; position: string } | undefined, street: ActionStreet) {
    if (!player) return "";
    return player.isHero ? draftStreetThoughts[street] ?? "" : draftPlayerProfiles[player.position] ?? "";
  }

  function updateActionNote(player: { isHero: boolean; position: string }, street: ActionStreet, value: string) {
    if (player.isHero) {
      setDraftStreetThoughts((thoughts) => ({ ...thoughts, [street]: value }));
      return;
    }

    setDraftPlayerProfiles((profiles) => ({ ...profiles, [player.position]: value }));
  }

  function preparePreflopForm(nextPosition: string | null, nextPlayers: PreflopPlayerState[], nextCurrentBet: number) {
    const nextPlayer = nextPosition
      ? nextPlayers.find((player) => player.position === nextPosition)
      : undefined;
    const nextStackBeforeBb = nextPlayer?.lastStackAfter ? parseBbInput(nextPlayer.lastStackAfter) : null;
    const nextStackBefore = nextStackBeforeBb == null ? "" : bbToChipInputValue(nextStackBeforeBb, activeBigBlindChips);

    setPreflopIntent("fold");
    setPreflopCommitTo(
      bbInputToChipInputValue(
        preflopDefaultCommitValue(nextPlayer, nextCurrentBet, nextStackBeforeBb, preflopAnteBb, preflopSmallBlindBb),
        activeBigBlindChips,
      ),
    );
    setPreflopStackBefore(nextStackBefore);
    setPreflopError("");
  }

  function preparePostflopForm(
    nextPosition: string | null,
    nextPlayers: PostflopPlayerState[],
    nextCurrentBet: number,
    nextPotBb: number,
  ) {
    const nextPlayer = nextPosition
      ? nextPlayers.find((player) => player.position === nextPosition)
      : undefined;
    const nextCallNeeded = nextPlayer ? Math.max(0, nextCurrentBet - nextPlayer.streetCommitted) : 0;
    const nextStackBefore = nextPlayer?.stackBb == null ? "" : bbToChipInputValue(nextPlayer.stackBb, activeBigBlindChips);

    setPostflopIntent(nextCallNeeded > 0 ? "fold" : "check");
    setPostflopCommitTo(
      bbInputToChipInputValue(
        postflopDefaultCommitValue(nextPlayer, nextCurrentBet, nextPotBb, nextPlayer?.stackBb ?? null),
        activeBigBlindChips,
      ),
    );
    setPostflopStackBefore(nextStackBefore);
    setPostflopError("");
  }

  function createCurrentPostflopSnapshot(): PostflopStreetSnapshot {
    return {
      actions: postflopActions.map((action) => ({ ...action })),
      boardCards: [...boardCards],
      commitTo: postflopCommitTo,
      currentBet: postflopCurrentBet,
      error: postflopError,
      intent: postflopIntent,
      lastRaiseSize: postflopLastRaiseSize,
      players: postflopPlayers.map((player) => ({ ...player })),
      potStart: postflopPotStart,
      queue: [...postflopQueue],
      stackBefore: postflopStackBefore,
    };
  }

  function restorePostflopStreet(street: PostflopStreet, snapshot: PostflopStreetSnapshot) {
    setReviewCreateStage(street);
    setBoardCards([...snapshot.boardCards]);
    setPostflopPlayers(snapshot.players.map((player) => ({ ...player })));
    setPostflopQueue([...snapshot.queue]);
    setPostflopPotStart(snapshot.potStart);
    setPostflopCurrentBet(snapshot.currentBet);
    setPostflopLastRaiseSize(snapshot.lastRaiseSize);
    setPostflopActions(snapshot.actions.map((action) => ({ ...action })));
    setPostflopIntent(snapshot.intent);
    setPostflopCommitTo(snapshot.commitTo);
    setPostflopStackBefore(snapshot.stackBefore);
    setPostflopError(snapshot.error);
  }

  function clearPostflopSnapshotsFrom(street: PostflopStreet) {
    const streetIndex = POSTFLOP_STREET_ORDER.indexOf(street);

    setPostflopStreetSnapshots((snapshots) =>
      Object.fromEntries(
        Object.entries(snapshots).filter(([snapshotStreet]) =>
          POSTFLOP_STREET_ORDER.indexOf(snapshotStreet as PostflopStreet) < streetIndex,
        ),
      ) as Partial<Record<PostflopStreet, PostflopStreetSnapshot>>,
    );
  }

  function startPostflopStreet(street: PostflopStreet, nextPlayers: PostflopPlayerState[], nextPotStart: number) {
    const nextQueue = postflopActionOrder(nextPlayers, reviewPlayerCount);

    setReviewCreateStage(street);
    setPostflopPlayers(nextPlayers);
    setPostflopQueue(nextQueue);
    setPostflopPotStart(roundBb(nextPotStart));
    setPostflopCurrentBet(0);
    setPostflopLastRaiseSize(1);
    setPostflopActions([]);
    preparePostflopForm(nextQueue[0] ?? null, nextPlayers, 0, roundBb(nextPotStart));
  }

  function enterFlop() {
    if (!hasReviewHeroPosition) {
      setPreflopError("请选择我的位置");
      return;
    }

    if (currentPreflopPosition) {
      setPreflopError("请先完成 Preflop 行动");
      return;
    }

    const nextPlayers = createPostflopPlayers(preflopPlayers);

    setBoardCards([]);
    setPostflopStreetSnapshots({});
    startPostflopStreet("flop", nextPlayers, preflopPotBb);
  }

  async function enterNextReviewStage() {
    if (reviewCreateStage === "hand") {
      if (heroCards.length !== 2) {
        setHeroHandError("请选择两张手牌");
        return;
      }

      resetActionDraft();
      setReviewCreateStage("preflop");
      return;
    }

    if (reviewCreateStage === "preflop") {
      if (currentPreflopPosition) {
        setPreflopError("请先完成 Preflop 行动");
        return;
      }

      if (livePreflopPlayerCount(preflopPlayers) < 2) {
        await createReview();
        return;
      }

      enterFlop();
      return;
    }

    if (!postflopBoardComplete) {
      setPostflopError(`请选择 ${BOARD_CARD_REQUIREMENT[currentPostflopStreet]} 张公共牌`);
      return;
    }

    if (currentPostflopPosition) {
      setPostflopError(`请先完成 ${REVIEW_STAGE_LABELS[currentPostflopStreet]} 行动`);
      return;
    }

    if (!nextReviewStage || nextReviewStage === "preflop" || livePostflopPlayerCount(postflopPlayers) < 2) {
      await createReview();
      return;
    }

    const nextStreet = nextReviewStage as PostflopStreet;
    const nextStreetIndex = POSTFLOP_STREET_ORDER.indexOf(nextStreet);
    const currentSnapshot = createCurrentPostflopSnapshot();
    const nextPlayers = resetStreetCommitted(postflopPlayers);

    setPostflopStreetSnapshots((snapshots) => ({
      ...Object.fromEntries(
        Object.entries(snapshots).filter(([snapshotStreet]) =>
          POSTFLOP_STREET_ORDER.indexOf(snapshotStreet as PostflopStreet) < nextStreetIndex,
        ),
      ),
      [currentPostflopStreet]: currentSnapshot,
    }));
    startPostflopStreet(nextStreet, nextPlayers, postflopPotBb);
  }

  function returnToPreviousReviewStage() {
    if (reviewCreateStage === "hand" || reviewCreateStage === "preflop" || !previousReviewStage) return;

    requestReviewDraftConfirm({
      confirmLabel: "确认返回",
      message: "返回上一阶段会清空当前街及后续录入。",
      onConfirm: () => {
        clearPostflopSnapshotsFrom(reviewCreateStage);

        if (previousReviewStage === "preflop") {
          setReviewCreateStage("preflop");
          return;
        }

        const previousPostflopStreet = previousReviewStage as PostflopStreet;
        const previousSnapshot = postflopStreetSnapshots[previousPostflopStreet];

        if (previousSnapshot) {
          restorePostflopStreet(previousPostflopStreet, previousSnapshot);
          return;
        }

        setReviewCreateStage(previousPostflopStreet);
      },
      title: "返回上一阶段？",
    });
  }

  function resetCurrentPostflopStreet() {
    requestReviewDraftConfirm({
      confirmLabel: "确认重置",
      message: `重置${REVIEW_STAGE_LABELS[currentPostflopStreet]}会清空当前街及后续录入。`,
      onConfirm: () => {
        if (reviewCreateStage === "hand" || reviewCreateStage === "preflop") {
          resetPreflop();
          return;
        }

        const keepCardCount = reviewCreateStage === "flop" ? 0 : BOARD_CARD_REQUIREMENT[PREVIOUS_REVIEW_STAGE[reviewCreateStage] as PostflopStreet];
        const nextPlayers = resetStreetCommitted(postflopPlayers);
        const nextPotStart = reviewCreateStage === "flop" ? preflopPotBb : postflopPotStart;

        clearPostflopSnapshotsFrom(reviewCreateStage);
        setBoardCards((cards) => cards.slice(0, keepCardCount));
        startPostflopStreet(reviewCreateStage, nextPlayers, nextPotStart);
      },
      title: `重置${REVIEW_STAGE_LABELS[currentPostflopStreet]}？`,
    });
  }

  function selectBoardCard(card: string) {
    if (reviewCreateStage === "preflop") return;
    if (heroCards.includes(card) || boardCards.includes(card) || boardCards.length >= requiredBoardCardCount) return;

    setBoardCards((cards) => [...cards, card]);
    setPostflopError("");
  }

  function applyPostflopAction() {
    if (reviewCreateStage === "preflop" || !currentPostflopPlayer || !currentPostflopPosition) return;

    if (!postflopBoardComplete) {
      setPostflopError(`请选择 ${BOARD_CARD_REQUIREMENT[currentPostflopStreet]} 张公共牌`);
      return;
    }

    const potBeforeAction = postflopPot(postflopPlayers, postflopPotStart);

    if (postflopIntent === "fold") {
      const nextPlayers = postflopPlayers.map((player) =>
        player.position === currentPostflopPosition ? { ...player, status: "folded" as const } : player,
      );
      const nextQueue = livePostflopPlayerCount(nextPlayers) <= 1
        ? []
        : activeActionQueue(postflopQueue.slice(1), nextPlayers);
      const nextPosition = nextActivePosition(nextQueue, nextPlayers);

      setPostflopPlayers(nextPlayers);
      setPostflopQueue(nextQueue);
      setPostflopActions((currentActions) => [
        ...currentActions,
        {
          action: "fold",
          addedBb: 0,
          committedBb: currentPostflopPlayer.streetCommitted,
          currentBetBefore: postflopCurrentBet,
          id: `${currentPostflopStreet}-${currentPostflopPosition}-${currentActions.length}`,
          position: currentPostflopPosition,
          potAfterBb: postflopPot(nextPlayers, postflopPotStart),
          potBeforeBb: potBeforeAction,
          street: currentPostflopStreet,
        },
      ]);
      preparePostflopForm(nextPosition, nextPlayers, postflopCurrentBet, postflopPot(nextPlayers, postflopPotStart));
      return;
    }

    if (postflopIntent === "check") {
      if (postflopCallNeeded > 0) {
        setPostflopError("当前需要跟注，不能过牌");
        return;
      }

      const nextQueue = activeActionQueue(postflopQueue.slice(1), postflopPlayers);
      const nextPosition = nextActivePosition(nextQueue, postflopPlayers);

      setPostflopQueue(nextQueue);
      setPostflopActions((currentActions) => [
        ...currentActions,
        {
          action: "check",
          addedBb: 0,
          committedBb: currentPostflopPlayer.streetCommitted,
          currentBetBefore: postflopCurrentBet,
          id: `${currentPostflopStreet}-${currentPostflopPosition}-${currentActions.length}`,
          position: currentPostflopPosition,
          potAfterBb: potBeforeAction,
          potBeforeBb: potBeforeAction,
          street: currentPostflopStreet,
        },
      ]);
      preparePostflopForm(nextPosition, postflopPlayers, postflopCurrentBet, potBeforeAction);
      return;
    }

    const nextCommit = postflopCommitToValue;
    const stackBefore = postflopStackBeforeValue;

    if (stackBefore == null || stackBefore <= 0) {
      setPostflopError("请输入行动前筹码");
      return;
    }

    const maxCommitTo = postflopMaxCommitForStack(currentPostflopPlayer, stackBefore);
    const effectiveMinimumCommit = Math.min(postflopMinimumCommit, maxCommitTo);

    if (nextCommit == null || nextCommit < effectiveMinimumCommit) {
      setPostflopError(`本街最少需要到 ${formatChipAmountWithBb(effectiveMinimumCommit, activeBigBlindChips)}`);
      return;
    }

    if (nextCommit > maxCommitTo) {
      setPostflopError(`本街最多只能到 ${formatChipAmountWithBb(maxCommitTo, activeBigBlindChips)}`);
      return;
    }

    if (postflopCurrentBet === 0 && nextCommit <= currentPostflopPlayer.streetCommitted) {
      setPostflopError("请输入下注量");
      return;
    }

    const addedBb = roundBb(nextCommit - currentPostflopPlayer.streetCommitted);

    if (addedBb < 0) {
      setPostflopError("投入量不能小于当前已投入");
      return;
    }

    if (addedBb > stackBefore) {
      setPostflopError("行动前筹码不足");
      return;
    }

    const stackAfter = roundBb(stackBefore - addedBb);
    const isAggressiveAction = nextCommit > postflopCurrentBet;
    const isFullRaise = isAggressiveAction && nextCommit >= postflopMinimumRaiseCommit;

    if (isAggressiveAction && !isFullRaise && stackAfter > 0) {
      setPostflopError(`加注最少需要到 ${formatChipAmountWithBb(postflopMinimumRaiseCommit, activeBigBlindChips)}`);
      return;
    }

    const action: PostflopActionKind = postflopCurrentBet === 0
      ? "bet"
      : isAggressiveAction
        ? "raise"
        : "call";
    const nextPlayers = postflopPlayers.map((player) =>
      player.position === currentPostflopPosition
        ? {
          ...player,
          stackBb: stackAfter,
          status: stackAfter === 0 ? "all-in" as const : "active" as const,
          streetCommitted: nextCommit,
        }
        : player,
    );
    const positionOrder = reviewPlayerCount === 2 ? POSTFLOP_HEADS_UP_ORDER : POSTFLOP_POSITION_ORDER;
    const nextQueue = isFullRaise
      ? activeActionQueue(positionsAfter(currentPostflopPosition, positionOrder), nextPlayers)
      : activeActionQueue(postflopQueue.slice(1), nextPlayers);
    const nextCurrentBet = isAggressiveAction ? nextCommit : postflopCurrentBet;
    const nextFinalQueue = livePostflopPlayerCount(nextPlayers) <= 1 ? [] : nextQueue;
    const nextPosition = nextActivePosition(nextFinalQueue, nextPlayers);
    const nextLastRaiseSize = isFullRaise ? roundBb(nextCommit - postflopCurrentBet) : postflopLastRaiseSize;
    const potAfterAction = postflopPot(nextPlayers, postflopPotStart);

    setPostflopPlayers(nextPlayers);
    setPostflopCurrentBet(nextCurrentBet);
    setPostflopLastRaiseSize(nextLastRaiseSize);
    setPostflopQueue(nextFinalQueue);
    setPostflopActions((currentActions) => [
      ...currentActions,
      {
        action,
        addedBb,
        committedBb: nextCommit,
        currentBetBefore: postflopCurrentBet,
        id: `${currentPostflopStreet}-${currentPostflopPosition}-${currentActions.length}`,
        position: currentPostflopPosition,
        potAfterBb: potAfterAction,
        potBeforeBb: potBeforeAction,
        stackAfterBb: stackAfter,
        stackBeforeBb: stackBefore,
        street: currentPostflopStreet,
      },
    ]);
    preparePostflopForm(nextPosition, nextPlayers, nextCurrentBet, potAfterAction);
  }

  function rememberPreflopSnapshot() {
    setPreflopHistory((history) => [
      ...history,
      {
        actions: preflopActions.map((action) => ({ ...action })),
        commitTo: preflopCommitTo,
        currentBet: preflopCurrentBet,
        error: preflopError,
        intent: preflopIntent,
        lastRaiseSize: preflopLastRaiseSize,
        players: preflopPlayers.map((player) => ({ ...player })),
        queue: [...preflopQueue],
        round: preflopRound,
        stackBefore: preflopStackBefore,
      },
    ]);
  }

  function undoPreflopAction() {
    const previousSnapshot = preflopHistory[preflopHistory.length - 1];
    if (!previousSnapshot) return;

    setPreflopPlayers(previousSnapshot.players.map((player) => ({ ...player })));
    setPreflopQueue([...previousSnapshot.queue]);
    setPreflopCurrentBet(previousSnapshot.currentBet);
    setPreflopLastRaiseSize(previousSnapshot.lastRaiseSize);
    setPreflopRound(previousSnapshot.round);
    setPreflopActions(previousSnapshot.actions.map((action) => ({ ...action })));
    setPreflopIntent(previousSnapshot.intent);
    setPreflopCommitTo(previousSnapshot.commitTo);
    setPreflopStackBefore(previousSnapshot.stackBefore);
    setPreflopError(previousSnapshot.error);
    setPreflopHistory((history) => history.slice(0, -1));
  }

  function selectReviewPlayerCount(playerCount: ReviewPlayerCount) {
    requestReviewDraftConfirm({
      confirmLabel: "确认调整",
      message: "调整人数会清空当前行动录入。",
      onConfirm: () => {
        setReviewPlayerCount(playerCount);
        setReviewHeroPosition("");
        resetPreflop(playerCount, "");
      },
      shouldConfirm: hasActionDraftProgress,
      title: "调整人数？",
    });
  }

  function selectReviewHeroPosition(position: string) {
    requestReviewDraftConfirm({
      confirmLabel: "确认调整",
      message: "调整我的位置会清空当前行动录入。",
      onConfirm: () => {
        setReviewHeroPosition(position);
        resetPreflop(reviewPlayerCount, position);
      },
      shouldConfirm: hasActionDraftProgress,
      title: "调整位置？",
    });
  }

  function smallBlindBbFromChips(smallBlindChips: string, bigBlindChips: string) {
    const smallBlind = parseFilledChipInput(smallBlindChips) ?? 0;
    const bigBlind = parseFilledChipInput(bigBlindChips);
    return chipAmountToBb(smallBlind, bigBlind && bigBlind > 0 ? bigBlind : activeBigBlindChips) ?? 0;
  }

  function updatePreflopSmallBlindChips(value: string) {
    requestReviewDraftConfirm({
      confirmLabel: "确认调整",
      message: "调整盲注会清空当前行动录入。",
      onConfirm: () => {
        setPreflopSmallBlindChips(value);
        resetPreflop(reviewPlayerCount, reviewHeroPosition, smallBlindBbFromChips(value, preflopBigBlindChips));
      },
      shouldConfirm: hasActionDraftProgress,
      title: "调整小盲？",
    });
  }

  function updatePreflopBigBlindChips(value: string) {
    requestReviewDraftConfirm({
      confirmLabel: "确认调整",
      message: "调整盲注会清空当前行动录入。",
      onConfirm: () => {
        setPreflopBigBlindChips(value);
        resetPreflop(reviewPlayerCount, reviewHeroPosition, smallBlindBbFromChips(preflopSmallBlindChips, value));
      },
      shouldConfirm: hasActionDraftProgress,
      title: "调整大盲？",
    });
  }

  function updatePreflopAnteChips(value: string) {
    requestReviewDraftConfirm({
      confirmLabel: "确认调整",
      message: "调整 ante 会清空当前行动录入。",
      onConfirm: () => {
        setPreflopAnteChips(value);
        if (preflopActions.length > 0) resetPreflop();
      },
      shouldConfirm: preflopActions.length > 0,
      title: "调整 Ante？",
    });
  }

  function fillPreflopAllIn() {
    if (preflopMaxCommitTo == null) return;

    setPreflopIntent("commit");
    setPreflopCommitTo(bbToChipInputValue(preflopMaxCommitTo, activeBigBlindChips));
    setPreflopError("");
  }

  function fillPostflopAllIn() {
    if (postflopMaxCommitTo == null) return;

    setPostflopIntent("commit");
    setPostflopCommitTo(bbToChipInputValue(postflopMaxCommitTo, activeBigBlindChips));
    setPostflopError("");
  }

  function jumpToPreflopPosition(position: string) {
    if (!hasReviewHeroPosition) {
      setPreflopError("请选择我的位置");
      return;
    }

    const targetIndex = activePreflopQueue.indexOf(position);
    if (targetIndex <= 0) return;

    rememberPreflopSnapshot();

    const skippedPositions = activePreflopQueue.slice(0, targetIndex);
    const nextPlayers = preflopPlayers.map((player) =>
      skippedPositions.includes(player.position) ? { ...player, status: "folded" as const } : player,
    );
    const nextQueue = livePreflopPlayerCount(nextPlayers) <= 1
      ? []
      : activeActionQueue(activePreflopQueue.slice(targetIndex), nextPlayers);
    const nextPosition = nextActivePosition(nextQueue, nextPlayers);
    const potAfterFolds = preflopPot(nextPlayers, preflopAnteBb);
    const skippedActions: PreflopActionLog[] = skippedPositions.map((skippedPosition, index) => {
      const skippedPlayer = preflopPlayers.find((player) => player.position === skippedPosition);

      return {
        action: "fold",
        addedBb: 0,
        committedBb: skippedPlayer?.committed ?? 0,
        currentBetBefore: preflopCurrentBet,
        id: `${skippedPosition}-${preflopActions.length + index}`,
        position: skippedPosition,
        potAfterBb: potAfterFolds,
        round: preflopRound,
      };
    });

    setPreflopPlayers(nextPlayers);
    setPreflopQueue(nextQueue);
    setPreflopActions((currentActions) => [...currentActions, ...skippedActions]);
    preparePreflopForm(nextPosition, nextPlayers, preflopCurrentBet);
  }

  function applyPreflopAction() {
    if (!currentPreflopPlayer || !currentPreflopPosition) return;

    if (!hasReviewHeroPosition) {
      setPreflopError("请选择我的位置");
      return;
    }

    if (preflopIntent === "fold") {
      rememberPreflopSnapshot();

      const nextPlayers = preflopPlayers.map((player) =>
        player.position === currentPreflopPosition ? { ...player, status: "folded" as const } : player,
      );
      const nextQueue = livePreflopPlayerCount(nextPlayers) <= 1
        ? []
        : activeActionQueue(preflopQueue.slice(1), nextPlayers);
      const nextPosition = nextActivePosition(nextQueue, nextPlayers);

      setPreflopPlayers(nextPlayers);
      setPreflopQueue(nextQueue);
      setPreflopActions((currentActions) => [
        ...currentActions,
        {
          action: "fold",
          addedBb: 0,
          committedBb: currentPreflopPlayer.committed,
          currentBetBefore: preflopCurrentBet,
          id: `${currentPreflopPosition}-${currentActions.length}`,
          position: currentPreflopPosition,
          potAfterBb: preflopPot(nextPlayers, preflopAnteBb),
          round: preflopRound,
        },
      ]);
      preparePreflopForm(nextPosition, nextPlayers, preflopCurrentBet);
      return;
    }

    const nextCommit = preflopCommitToValue;
    const stackBefore = preflopStackBeforeValue;

    if (stackBefore == null || stackBefore <= 0) {
      setPreflopError("请输入行动前筹码");
      return;
    }

    const maxCommitTo = preflopMaxCommitForStack(currentPreflopPlayer, stackBefore, preflopAnteBb, preflopSmallBlindBb);
    const effectiveMinimumCommit = Math.min(preflopMinimumCommit, maxCommitTo);

    if (nextCommit == null || nextCommit < effectiveMinimumCommit) {
      setPreflopError(`本轮最少需要到 ${formatChipAmountWithBb(effectiveMinimumCommit, activeBigBlindChips)}`);
      return;
    }

    if (nextCommit > maxCommitTo) {
      setPreflopError(`本轮最多只能到 ${formatChipAmountWithBb(maxCommitTo, activeBigBlindChips)}`);
      return;
    }

    const addedBb = roundBb(nextCommit - currentPreflopPlayer.committed);
    if (addedBb < 0) {
      setPreflopError("投入量不能小于当前已投入");
      return;
    }

    const stackAfter = preflopStackAfterForCommit(currentPreflopPlayer, stackBefore, nextCommit, preflopAnteBb, preflopSmallBlindBb);

    if (stackAfter < 0) {
      setPreflopError("行动前筹码不足");
      return;
    }

    const isRaise = nextCommit > preflopCurrentBet;
    const isFullRaise = isRaise && nextCommit >= preflopMinimumRaiseCommit;

    if (isRaise && !isFullRaise && stackAfter > 0) {
      setPreflopError(`加注最少需要到 ${formatChipAmountWithBb(preflopMinimumRaiseCommit, activeBigBlindChips)}`);
      return;
    }

    rememberPreflopSnapshot();

    const action: PreflopActionKind = isRaise
      ? "raise"
      : addedBb > 0
        ? "call"
        : "check";
    const nextPlayers = preflopPlayers.map((player) =>
      player.position === currentPreflopPosition
        ? {
          ...player,
          committed: nextCommit,
          lastStackAfter: bbInputValue(stackAfter),
          status: stackAfter === 0 ? "all-in" as const : "active" as const,
        }
        : player,
    );
    const nextQueue = isFullRaise
      ? activeActionQueue(positionsAfter(currentPreflopPosition, reviewPositions), nextPlayers)
      : activeActionQueue(preflopQueue.slice(1), nextPlayers);
    const nextCurrentBet = isRaise ? nextCommit : preflopCurrentBet;
    const nextFinalQueue = livePreflopPlayerCount(nextPlayers) <= 1 ? [] : nextQueue;
    const nextPosition = nextActivePosition(nextFinalQueue, nextPlayers);
    const nextLastRaiseSize = isFullRaise ? roundBb(nextCommit - preflopCurrentBet) : preflopLastRaiseSize;

    setPreflopPlayers(nextPlayers);
    setPreflopCurrentBet(nextCurrentBet);
    setPreflopLastRaiseSize(nextLastRaiseSize);
    setPreflopQueue(nextFinalQueue);
    if (isFullRaise) setPreflopRound((currentRound) => currentRound + 1);
    setPreflopActions((currentActions) => [
      ...currentActions,
      {
        action,
        addedBb,
        committedBb: nextCommit,
        currentBetBefore: preflopCurrentBet,
        id: `${currentPreflopPosition}-${currentActions.length}`,
        position: currentPreflopPosition,
        potAfterBb: preflopPot(nextPlayers, preflopAnteBb),
        round: preflopRound,
        stackAfterBb: stackAfter,
        stackBeforeBb: stackBefore,
      },
    ]);
    preparePreflopForm(nextPosition, nextPlayers, nextCurrentBet);
  }

  function syncReviews(data: ReviewsApiResponse, fallbackReviews: ReviewHandSpot[]) {
    const syncedReviews = data.reviews ?? fallbackReviews;
    setReviews(syncedReviews);
    setReviewsEtag(data.etag ?? null);
    setReviewsError("");
    setIsReviewsLoading(false);
    return syncedReviews;
  }

  function resetGtoEditor() {
    setEditingGtoStreet("");
    setGtoDraft("");
  }

  function selectReviewHand(id: string) {
    if (id === selectedId) return;
    resetGtoEditor();
    setSelectedId(id);
  }

  function startGtoEdit(streetName: ReviewStreet["street"], currentThought: string) {
    if (isReviewMutating) return;
    setEditingGtoStreet(streetName);
    setGtoDraft(currentThought === "待补充" || currentThought === "未记录" ? "" : currentThought);
  }

  function cancelGtoEdit() {
    if (savingGtoStreet) return;
    setEditingGtoStreet("");
    setGtoDraft("");
  }

  async function saveGtoThought(streetName: ReviewStreet["street"]) {
    if (!selectedHand || savingGtoStreet) return;

    let didUpdateStreet = false;
    const nextThought = gtoDraft.trim() || "待补充";
    const nextStreets = selectedHand.streets.map((street) => {
      if (street.street !== streetName) return street;
      didUpdateStreet = true;
      return {
        ...street,
        gtoThought: nextThought,
      };
    });

    if (!didUpdateStreet) {
      setToast("没有找到这条街");
      return;
    }

    const nextReviews = reviews.map((review) =>
      review.id === selectedHand.id
        ? {
          ...review,
          streets: nextStreets,
        }
        : review,
    );

    setSavingGtoStreet(streetName);

    try {
      const response = await fetch("/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedHand.id,
          review: { streets: nextStreets },
        }),
      });
      const data = (await response.json()) as ReviewsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "保存失败");
      }

      syncReviews(data, nextReviews);
      setEditingGtoStreet("");
      setGtoDraft("");
      setToast("GTO 想法已保存");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请稍后再试");
    } finally {
      setSavingGtoStreet("");
    }
  }

  function preflopStackText(player: PreflopPlayerState) {
    if (player.status === "folded") return "Fold";
    if (player.status === "all-in") return "All-in";
    if (player.lastStackAfter) return formatChipAmountWithBbFromString(player.lastStackAfter, activeBigBlindChips);
    return `${formatChipAmountWithBb(player.committed, activeBigBlindChips)} 已投`;
  }

  function postflopStackText(player: PostflopPlayerState) {
    if (player.status === "folded") return "Fold";
    if (player.status === "all-in" || player.stackBb === 0) return "All-in";
    return player.stackBb == null ? "未记录" : formatChipAmountWithBb(player.stackBb, activeBigBlindChips);
  }

  function buildReviewPlayerProfiles() {
    return Object.entries(draftPlayerProfiles)
      .map(([position, profile]) => ({ position, profile: profile.trim() }))
      .filter((profile): profile is ReviewPlayerProfile => Boolean(profile.profile));
  }

  function reviewStreetAmountFields(amountBb: number | undefined) {
    if (amountBb === undefined) return {};

    return {
      amountBb,
      amountChips: bbToChipAmount(amountBb, activeBigBlindChips),
    };
  }

  function buildPreflopReviewAction(action: PreflopActionLog): ReviewStreetAction {
    const reviewAction = action.action === "raise"
      ? action.currentBetBefore <= 1
        ? "open"
        : "raise"
      : action.action;
    const amountBb = action.action === "call"
      ? action.addedBb
      : action.action === "raise"
        ? action.committedBb
        : undefined;

    return {
      action: reviewAction,
      position: action.position,
      ...reviewStreetAmountFields(amountBb),
      addedBb: action.addedBb,
      addedChips: bbToChipAmount(action.addedBb, activeBigBlindChips),
      committedBb: action.committedBb,
      committedChips: bbToChipAmount(action.committedBb, activeBigBlindChips),
      potAfterBb: action.potAfterBb,
      potAfterChips: bbToChipAmount(action.potAfterBb, activeBigBlindChips),
      ...(action.stackBeforeBb !== undefined
        ? {
          stackBeforeBb: action.stackBeforeBb,
          stackBeforeChips: bbToChipAmount(action.stackBeforeBb, activeBigBlindChips),
        }
        : {}),
      ...(action.stackAfterBb !== undefined
        ? {
          stackAfterBb: action.stackAfterBb,
          stackAfterChips: bbToChipAmount(action.stackAfterBb, activeBigBlindChips),
          isAllIn: action.stackAfterBb === 0,
        }
        : {}),
    };
  }

  function buildPostflopReviewAction(action: PostflopActionLog): ReviewStreetAction {
    const amountBb = action.action === "call"
      ? action.addedBb
      : action.action === "bet" || action.action === "raise"
        ? action.committedBb
        : undefined;

    return {
      action: action.action,
      position: action.position,
      ...reviewStreetAmountFields(amountBb),
      addedBb: action.addedBb,
      addedChips: bbToChipAmount(action.addedBb, activeBigBlindChips),
      committedBb: action.committedBb,
      committedChips: bbToChipAmount(action.committedBb, activeBigBlindChips),
      potBeforeBb: action.potBeforeBb,
      potBeforeChips: bbToChipAmount(action.potBeforeBb, activeBigBlindChips),
      potAfterBb: action.potAfterBb,
      potAfterChips: bbToChipAmount(action.potAfterBb, activeBigBlindChips),
      ...(action.stackBeforeBb !== undefined
        ? {
          stackBeforeBb: action.stackBeforeBb,
          stackBeforeChips: bbToChipAmount(action.stackBeforeBb, activeBigBlindChips),
        }
        : {}),
      ...(action.stackAfterBb !== undefined
        ? {
          stackAfterBb: action.stackAfterBb,
          stackAfterChips: bbToChipAmount(action.stackAfterBb, activeBigBlindChips),
          isAllIn: action.stackAfterBb === 0,
        }
        : {}),
    };
  }

  function postflopSnapshotForReview(street: PostflopStreet) {
    if (reviewCreateStage === street) return createCurrentPostflopSnapshot();
    return postflopStreetSnapshots[street] ?? null;
  }

  function buildReviewStreetFromPostflop(street: PostflopStreet, board: ReviewHandSpot["board"]): ReviewStreet {
    const snapshot = postflopSnapshotForReview(street);
    const streetName: ReviewStreet["street"] = street === "flop" ? "Flop" : street === "turn" ? "Turn" : "River";
    const boardValue = street === "flop" ? board.flop : street === "turn" ? board.turn : board.river;
    const actions = snapshot?.actions ?? [];
    const players = snapshot?.players ?? [];

    if (!snapshot) {
      return {
        street: streetName,
        board: boardValue,
        actionLine: "未发生",
        actions: [],
        playerStacks: [],
        myThought: "未发生",
        gtoThought: "待补充",
      };
    }

    const potStart = snapshot?.potStart ?? 0;
    const potAfter = actions[actions.length - 1]?.potAfterBb ?? postflopPot(players, potStart);
    const betSizes = actions
      .filter((action) => action.action === "bet" || action.action === "raise")
      .map((action) => ({
        amountBb: action.action === "raise" ? action.committedBb : action.addedBb,
        amountChips: bbToChipAmount(action.action === "raise" ? action.committedBb : action.addedBb, activeBigBlindChips),
        potBb: action.potBeforeBb,
        potChips: bbToChipAmount(action.potBeforeBb, activeBigBlindChips),
      }));

    return {
      street: streetName,
      board: boardValue,
      actionLine: actions.length ? actions.map((action) => formatPostflopAction(action, activeBigBlindChips)).join(", ") : "未记录",
      actions: actions.map(buildPostflopReviewAction),
      ...(betSizes.length ? { betSizes } : {}),
      potBb: roundBb(potAfter),
      playerStacks: players.map((player) => ({
        position: player.position,
        stack: postflopStackText(player),
        ...(player.isHero ? { isHero: true } : {}),
      })),
      myThought: draftStreetThoughts[street]?.trim() || "未记录",
      gtoThought: "待补充",
    };
  }

  function buildReviewFromDraft(): ReviewHandSpot | null {
    if (!hasReviewHeroPosition) {
      setPreflopError("请选择我的位置");
      return null;
    }

    const heroHand = cardLabelLine(heroCards);
    if (!heroHand) {
      setHeroHandError("请选择两张手牌");
      return null;
    }

    const board = {
      flop: cardLabelLine(boardCards.slice(0, 3)) || "-",
      turn: boardCards[3] ? cardLabel(boardCards[3]) : "-",
      river: boardCards[4] ? cardLabel(boardCards[4]) : "-",
    };
    const playerProfiles = buildReviewPlayerProfiles();
    const opponentPositions = preflopPlayers
      .filter((player) => !player.isHero)
      .map((player) => player.position);
    const opponentPosition = opponentPositions.join(" / ") || "对手";
    const opponentProfile = playerProfiles.map((profile) => `${profile.position}: ${profile.profile}`).join(" / ") || "未记录";
    const heroStackBefore = preflopActions.find((action) =>
      action.position === reviewHeroPosition && action.stackBeforeBb != null
    )?.stackBeforeBb;
    const preflopPotAfter = preflopActions[preflopActions.length - 1]?.potAfterBb ?? preflopPotBb;
    const finalPot = reviewCreateStage === "preflop" ? preflopPotAfter : postflopPotBb;
    const streets: ReviewStreet[] = [
      {
        street: "Preflop",
        board: "-",
        actionLine: preflopActions.length ? preflopActions.map((action) => formatPreflopAction(action, activeBigBlindChips)).join(", ") : "未记录",
        actions: preflopActions.map(buildPreflopReviewAction),
        potBb: roundBb(preflopPotAfter),
        playerStacks: preflopPlayers.map((player) => ({
          position: player.position,
          stack: preflopStackText(player),
          ...(player.isHero ? { isHero: true } : {}),
        })),
        myThought: draftStreetThoughts.preflop?.trim() || "未记录",
        gtoThought: "待补充",
      },
      buildReviewStreetFromPostflop("flop", board),
      buildReviewStreetFromPostflop("turn", board),
      buildReviewStreetFromPostflop("river", board),
    ];

    return {
      id: newReviewId(),
      heroHand,
      heroPosition: reviewHeroPosition,
      opponentPosition,
      opponentProfile,
      playerProfiles,
      effectiveStack: heroStackBefore == null ? "未记录" : formatChipAmountWithBb(heroStackBefore, activeBigBlindChips),
      potType: "手动复盘",
      potSize: formatChipAmountWithBb(finalPot, activeBigBlindChips),
      board,
      issue: `${reviewHeroPosition} ${heroHand} 复盘`,
      status: "待复盘",
      evLossBb: 0,
      tags: ["手动记录"],
      streets,
      mistake: "待补充",
      gtoSummary: "待补充",
      takeaway: "待补充",
    };
  }

  async function createReview() {
    if (isReviewMutating) return false;

    const review = buildReviewFromDraft();
    if (!review) return false;

    setIsReviewSaving(true);

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review, etag: reviewsEtag }),
      });
      const data = (await response.json()) as ReviewsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "保存失败");
      }

      syncReviews(data, [review, ...reviews.filter((item) => item.id !== review.id)]);
      setSelectedId(review.id);
      resetGtoEditor();
      setHandPage(1);
      setIsReviewCreateOpen(false);
      setToast("复盘已保存");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请稍后再试");
      return false;
    } finally {
      setIsReviewSaving(false);
    }
  }

  function requestDeleteReview(review: ReviewHandSpot) {
    if (isReviewMutating) return;
    setReviewDeleteTarget(review);
  }

  function closeReviewDeleteConfirm() {
    if (deletingReviewId) return;
    setReviewDeleteTarget(null);
  }

  async function deleteReviewFromList() {
    const review = reviewDeleteTarget;
    if (!review || isReviewMutating) return;

    const nextReviews = reviews.filter((item) => item.id !== review.id);
    setDeletingReviewId(review.id);

    try {
      const response = await fetch("/api/reviews", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: review.id, etag: reviewsEtag }),
      });
      const data = (await response.json()) as ReviewsApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "删除失败");
      }

      const syncedReviews = syncReviews(data, nextReviews);
      setSelectedId(syncedReviews[0]?.id ?? "");
      resetGtoEditor();
      setHandPage(1);
      setReviewDeleteTarget(null);
      setToast("复盘已删除");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除失败，请稍后再试");
    } finally {
      setDeletingReviewId("");
    }
  }

  function goToPage(page: number) {
    const nextPage = Math.min(Math.max(page, 1), pageCount);
    const nextHand = reviews[(nextPage - 1) * HANDS_PER_PAGE];

    setHandPage(nextPage);
    if (nextHand) selectReviewHand(nextHand.id);
  }

  const fallbackPlayerStacks: ReviewStreetPlayerStack[] = selectedHand
    ? [
        { position: selectedHand.heroPosition, stack: selectedHand.effectiveStack, isHero: true },
        { position: selectedHand.opponentPosition, stack: selectedHand.effectiveStack },
      ]
    : [];
  const playerProfiles =
    selectedHand?.playerProfiles?.length
      ? selectedHand.playerProfiles
      : selectedHand
        ? [{ position: selectedHand.opponentPosition, profile: selectedHand.opponentProfile }]
        : [];

  const preflopStreet = selectedHand
    ? selectedHand.streets.find((street) => street.street === "Preflop") ?? {
        actionLine: "未记录",
        actions: [],
        betSizes: [],
        board: "-",
        gtoThought: "未记录",
        myThought: "未记录",
        playerStacks: fallbackPlayerStacks,
        potBb: Number.parseFloat(selectedHand.potSize),
        street: "Preflop",
      }
    : null;
  const postflopStreets = selectedHand
    ? (["Flop", "Turn", "River"] as ReviewStreet["street"][]).map((streetName) => {
        const street = selectedHand.streets.find((item) => item.street === streetName);
        const board =
          streetName === "Flop"
            ? selectedHand.board.flop
            : streetName === "Turn"
              ? selectedHand.board.turn
              : selectedHand.board.river;

        return {
          actionLine: street?.actionLine ?? "未记录",
          actions: street?.actions ?? [],
          betSizes: street?.betSizes ?? [],
          board,
          gtoThought: street?.gtoThought ?? "未记录",
          myThought: street?.myThought ?? "未记录",
          playerStacks: street?.playerStacks ?? fallbackPlayerStacks,
          potBb: street?.potBb,
          street: streetName,
        };
      })
    : [];

  return (
    <>
    <main className="page-canvas">
      <section className="split-page review-page hand-review-page">
        <aside className="review-hand-queue" aria-label="复盘手牌列表">
          <button
            className="review-new-hand-button"
            disabled={isReviewMutating}
            type="button"
            onClick={() => {
              restartHeroHandSelection();
              setIsReviewCreateOpen(true);
            }}
          >
            {isReviewSaving ? "保存中" : "新增手牌"}
          </button>

          <div className={`review-hand-list ${isReviewsLoading || hasReviewsError || !hasReviews ? "is-state" : ""}`}>
            {isReviewsLoading ? (
              <div className="record-state review-state-card record-loading" role="status" aria-live="polite">
                <i aria-hidden="true" />
                <strong>读取复盘中</strong>
              </div>
            ) : hasReviewsError ? (
              <div className="record-state review-state-card record-error" role="status">
                <strong>复盘同步失败</strong>
                <span>{reviewsError}</span>
              </div>
            ) : !hasReviews ? (
              <div className="record-state review-state-card record-empty">
                <strong>还没有复盘</strong>
                <span>新增第一手后会显示在这里。</span>
              </div>
            ) : pageHands.map((hand) => (
              <article
                className={`review-hand-card ${hand.id === selectedHand?.id ? "active" : ""}`}
                key={hand.id}
              >
                <button
                  type="button"
                  className="review-hand-card-main"
                  onClick={() => selectReviewHand(hand.id)}
                >
                  <CardImages label={hand.heroHand} value={hand.heroHand} variant="compact" />
                  <strong className="review-pot-size">{hand.potSize}</strong>
                </button>
                <button
                  aria-label={`删除 ${hand.heroHand}`}
                  className="review-hand-delete"
                  disabled={isReviewMutating}
                  title="删除"
                  type="button"
                  onClick={() => requestDeleteReview(hand)}
                >
                  <TrashIcon />
                </button>
              </article>
            ))}
          </div>

          <div className="review-hand-pager" aria-label="复盘列表翻页">
            <button
              aria-label="上一页"
              disabled={isReviewsLoading || !hasReviews || currentPage === 1}
              onClick={() => goToPage(currentPage - 1)}
              type="button"
            >
              ‹
            </button>
            <strong>{hasReviews ? `${currentPage} / ${pageCount}` : "0 / 0"}</strong>
            <button
              aria-label="下一页"
              disabled={isReviewsLoading || !hasReviews || currentPage === pageCount}
              onClick={() => goToPage(currentPage + 1)}
              type="button"
            >
              ›
            </button>
          </div>
        </aside>

        <section className="review-main-board" aria-label="当前手牌复盘">
          <div className="review-main-scroll">
            {selectedHand && preflopStreet ? (
              <>
                <PlayerProfileStrip profiles={playerProfiles} />

                <div className="review-street-lines review-preflop-review">
                  <StreetReviewCard
                    editingGtoStreet={editingGtoStreet}
                    gtoDraft={gtoDraft}
                    isGtoSaving={savingGtoStreet === preflopStreet.street}
                    isReviewMutating={isReviewMutating}
                    street={preflopStreet}
                    onCancelGtoEdit={cancelGtoEdit}
                    onChangeGtoDraft={setGtoDraft}
                    onSaveGtoThought={saveGtoThought}
                    onStartGtoEdit={startGtoEdit}
                  />
                </div>

                <div className="review-board-runout" aria-label="公共牌">
                  {postflopStreets.map((street) => (
                    <article aria-label={street.street} key={street.street}>
                      <CardImages label={street.board} value={street.board} variant="board" />
                    </article>
                  ))}
                </div>

                <div className="review-street-lines review-postflop-lines">
                  {postflopStreets.map((street) => (
                    <StreetReviewCard
                      editingGtoStreet={editingGtoStreet}
                      gtoDraft={gtoDraft}
                      isGtoSaving={savingGtoStreet === street.street}
                      isReviewMutating={isReviewMutating}
                      key={street.street}
                      street={street}
                      onCancelGtoEdit={cancelGtoEdit}
                      onChangeGtoDraft={setGtoDraft}
                      onSaveGtoThought={saveGtoThought}
                      onStartGtoEdit={startGtoEdit}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="record-state review-state-card review-main-state">
                <strong>{isReviewsLoading ? "读取复盘中" : hasReviewsError ? "复盘同步失败" : "还没有复盘"}</strong>
                {isReviewsLoading ? null : (
                  <span>{hasReviewsError ? reviewsError : "新增第一手后，这里会显示行动线。"}</span>
                )}
              </div>
            )}
          </div>
        </section>
      </section>
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </main>
    {isReviewCreateOpen ? (
      <div className="record-modal review-create-modal" role="dialog" aria-modal="true" aria-labelledby="review-create-title">
        <section className="record-modal-form review-create-modal-form">
          <header className="record-modal-head">
            <div>
              <strong id="review-create-title">{REVIEW_STAGE_LABELS[reviewCreateStage]}</strong>
            </div>
            <button
              aria-label="关闭"
              className="record-modal-close"
              type="button"
              onClick={closeReviewCreateModal}
            >
              <span aria-hidden="true" />
            </button>
          </header>

          <div className="review-create-grid">
            {reviewCreateStage === "hand" ? (
              <section className="review-create-card review-board-picker-card review-hand-picker-card">
                {heroHandError ? <p className="review-preflop-error">{heroHandError}</p> : null}
                <div className="review-hand-card-matrix" aria-label="手牌选择">
                  {CARD_SUITS.map((suit) => (
                    <div className="review-hand-suit-row" key={suit.code}>
                      {CARD_RANKS.map((rank) => {
                          const card = `${rank}${suit.code}`;
                          const isSelected = heroCards.includes(card);
                          const isDisabled = !isSelected && heroCards.length >= 2;

                          return (
                            <button
                              aria-label={`选择 ${card}`}
                              className={isSelected ? "is-selected" : undefined}
                              disabled={isDisabled}
                              key={card}
                              onClick={() => selectHeroCard(card)}
                              type="button"
                            >
                              <Image
                                alt={card}
                                height={162}
                                src={`/assets/cards/${card}.png`}
                                width={122}
                              />
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </section>
            ) : reviewCreateStage === "preflop" ? (
              <>
            <section className="review-create-card">
              <div className="review-create-field">
                <span>当前人数</span>
                <div className="review-choice-grid is-count" aria-label="当前人数">
                  {PLAYER_COUNTS.map((playerCount) => (
                    <button
                      className={reviewPlayerCount === playerCount ? "active" : undefined}
                      key={playerCount}
                      type="button"
                      onClick={() => selectReviewPlayerCount(playerCount)}
                    >
                      {playerCount}
                    </button>
                  ))}
                </div>
              </div>

              <div className="review-create-field">
                <span>我的位置</span>
                <div className="review-choice-grid is-position" aria-label="我的位置">
                  {reviewPositions.map((position) => (
                    <button
                      className={reviewHeroPosition === position ? "active" : undefined}
                      key={position}
                      type="button"
                      onClick={() => selectReviewHeroPosition(position)}
                    >
                      {position}
                    </button>
                  ))}
                </div>
                {!hasReviewHeroPosition ? <p className="review-required-hint">请选择我的位置</p> : null}
              </div>

              <div className="review-blind-strip" aria-label="盲注和 Ante">
                <label className="review-blind-field">
                  <span>SB</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={preflopSmallBlindChips}
                    onChange={(event) => updatePreflopSmallBlindChips(event.target.value)}
                  />
                </label>
                <label className="review-blind-field">
                  <span>BB</span>
                  <input
                    min="1"
                    step="1"
                    type="number"
                    value={preflopBigBlindChips}
                    onChange={(event) => updatePreflopBigBlindChips(event.target.value)}
                  />
                </label>
                <label className="review-blind-field">
                  <span>ANTE</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={preflopAnteChips}
                    onChange={(event) => updatePreflopAnteChips(event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="review-create-card review-preflop-card">
              <div className="review-preflop-workbench">
                <div className="review-preflop-roster" aria-label="位置行动队列">
                  {preflopPlayers.map((player) => {
                    const canJumpToPlayer = hasReviewHeroPosition && activePreflopQueue.indexOf(player.position) > 0;

                    return (
                      <button
                        aria-label={canJumpToPlayer ? `跳到 ${player.position} 行动` : `${player.position} 状态`}
                        className={[
                          player.position === currentPreflopPosition ? "is-current" : "",
                          canJumpToPlayer ? "is-jumpable" : "",
                          player.isHero ? "is-hero" : "",
                          player.status === "folded" ? "is-folded" : "",
                          player.status === "all-in" ? "is-all-in" : "",
                        ].filter(Boolean).join(" ")}
                        disabled={!canJumpToPlayer}
                        key={player.position}
                        onClick={() => jumpToPreflopPosition(player.position)}
                        type="button"
                      >
                        <strong>{player.position}</strong>
                        <b>{formatChips(bbToChipAmount(player.committed, activeBigBlindChips))}</b>
                        <small>{[
                          preflopAnteBb > 0 ? `Ante ${formatChipAmountWithBb(preflopAnteBb, activeBigBlindChips)}` : "",
                          player.lastStackAfter
                            ? `剩 ${formatChipAmountWithBbFromString(player.lastStackAfter, activeBigBlindChips)}`
                            : player.position === "SB" || player.position === "BB"
                              ? `自动盲注 ${formatBb(player.committed)}`
                              : "未记录筹码",
                        ].filter(Boolean).join(" · ")}</small>
                      </button>
                    );
                  })}
                </div>

                <div className="review-preflop-actor">
                  {currentPreflopPlayer ? (
                    <>
                      <div className="review-preflop-actor-head">
                        <span>当前行动</span>
                        <strong className={currentPreflopPlayer.isHero ? "is-hero" : undefined}>
                          {currentPreflopPlayer.position}
                        </strong>
                      </div>

                      <div className="review-action-toggle" aria-label="行动选择">
                        <button
                          className={preflopIntent === "fold" ? "active" : undefined}
                          type="button"
                          onClick={() => {
                            setPreflopIntent("fold");
                            setPreflopError("");
                          }}
                        >
                          弃牌
                        </button>
                        <button
                          className={preflopIntent === "commit" ? "active" : undefined}
                          type="button"
                          onClick={() => {
                            setPreflopIntent("commit");
                            setPreflopCommitTo(
                              bbInputToChipInputValue(
                                preflopDefaultCommitValue(
                                  currentPreflopPlayer,
                                  preflopCurrentBet,
                                  preflopStackBeforeValue,
                                  preflopAnteBb,
                                  preflopSmallBlindBb,
                                ),
                                activeBigBlindChips,
                              ),
                            );
                            setPreflopError("");
                          }}
                        >
                          {isPreflopCoveredAllIn
                            ? "跟注"
                            : preflopCurrentBet <= 1
                            ? preflopCallNeeded > 0
                              ? "下注"
                              : "过牌 / 下注"
                            : "跟注 / 加注"}
                        </button>
                      </div>

                      {preflopIntent === "commit" ? (
                        <>
                          <div className="review-preflop-inputs">
                            <label>
                              <span>行动前筹码</span>
                              <input
                                min="0"
                                step="1"
                                type="number"
                                value={preflopStackBefore}
                                onChange={(event) => {
                                  const nextStackBefore = event.target.value;
                                  const nextStackBeforeBb = chipAmountToBb(parseFilledChipInput(nextStackBefore), activeBigBlindChips);
                                  setPreflopStackBefore(nextStackBefore);

                                  if (preflopIntent === "commit") {
                                    setPreflopCommitTo(
                                      bbInputToChipInputValue(
                                        preflopDefaultCommitValue(
                                          currentPreflopPlayer,
                                          preflopCurrentBet,
                                          nextStackBeforeBb,
                                          preflopAnteBb,
                                          preflopSmallBlindBb,
                                        ),
                                        activeBigBlindChips,
                                      ),
                                    );
                                  }
                                }}
                              />
                            </label>
                            <label className="review-commit-field">
                              <span>本轮总投入</span>
                              <input
                                disabled={isPreflopCommitInputDisabled}
                                max={preflopMaxCommitTo == null ? undefined : bbToChipInputValue(preflopMaxCommitTo, activeBigBlindChips)}
                                min={bbToChipInputValue(preflopEffectiveMinimumCommit, activeBigBlindChips)}
                                step="1"
                                type="number"
                                value={preflopCommitToInputValue}
                                onChange={(event) => setPreflopCommitTo(event.target.value)}
                              />
                            </label>
                            <button
                              aria-label={`All-in 到 ${preflopMaxCommitTo == null ? "-" : formatChipAmountWithBb(preflopMaxCommitTo, activeBigBlindChips)}`}
                              className="review-all-in-button"
                              disabled={!canPreflopAllIn}
                              type="button"
                              onClick={fillPreflopAllIn}
                            >
                              All-in
                            </button>
                          </div>
                          <label className="review-action-note-field">
                            <span>{currentPreflopPlayer.isHero ? "我的想法" : "玩家画像"}</span>
                            <textarea
                              rows={4}
                              value={actionNoteValue(currentPreflopPlayer, "preflop")}
                              onChange={(event) => updateActionNote(currentPreflopPlayer, "preflop", event.target.value)}
                            />
                          </label>
                        </>
                      ) : null}

                      {preflopError ? <p className="review-preflop-error">{preflopError}</p> : null}

                      <button className="review-preflop-apply" type="button" onClick={applyPreflopAction}>
                        确认行动
                      </button>
                    </>
                  ) : (
                    <div className="review-preflop-complete">
                      <span>Preflop 完成</span>
                      <strong>{preflopPlayers.filter((player) => player.status !== "folded").map((player) => player.position).join(" / ")}</strong>
                      <button type="button" onClick={resetPreflopWithConfirm}>
                        重置 Preflop
                      </button>
                    </div>
                  )}
                </div>

                <div className="review-preflop-log" aria-label="行动线预览">
                  <ol ref={preflopLogRef}>
                    {preflopActions.length ? (
                      preflopActions.map((action) => (
                        <li key={action.id}>
                          <span>{formatPreflopAction(action, activeBigBlindChips)}</span>
                          <b>{formatChipAmountWithBb(action.potAfterBb, activeBigBlindChips)}</b>
                        </li>
                      ))
                    ) : (
                      <li className="is-empty">
                        <span>等待第一步行动</span>
                        <b>{formatChipAmountWithBb(preflopPotBb, activeBigBlindChips)}</b>
                      </li>
                    )}
                  </ol>
                </div>
              </div>
            </section>
              </>
            ) : (
              <>
                <section className="review-create-card review-board-picker-card">
                  <div className="review-board-selected">
                    {[
                      { label: "FLOP", value: flopBoardValue },
                      { label: "TURN", value: turnBoardValue },
                      { label: "RIVER", value: riverBoardValue },
                    ].map((boardRow) => (
                      <div className="review-board-row" key={boardRow.label}>
                        <span>{boardRow.label}</span>
                        <CardImages label={boardRow.label} value={boardRow.value} variant="board" />
                      </div>
                    ))}
                  </div>

                  <div className="review-card-matrix" aria-label="公共牌选择">
                    {CARD_RANKS.map((rank) => (
                      <div className="review-card-rank-row" key={rank}>
                          {CARD_SUITS.map((suit) => {
                            const card = `${rank}${suit.code}`;
                            const isSelected = boardCards.includes(card);
                            const isHeroCard = heroCards.includes(card);
                            const isDisabled = isHeroCard || isSelected || boardCards.length >= requiredBoardCardCount;

                            return (
                              <button
                                aria-label={`选择 ${card}`}
                                className={[
                                  isSelected ? "is-selected" : "",
                                  isHeroCard ? "is-blocked" : "",
                                ].filter(Boolean).join(" ")}
                                disabled={isDisabled}
                                key={card}
                                onClick={() => selectBoardCard(card)}
                                type="button"
                              >
                                <Image
                                  alt={card}
                                  height={162}
                                  src={`/assets/cards/${card}.png`}
                                  width={122}
                                />
                              </button>
                            );
                          })}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="review-create-card review-preflop-card">
                  <div className="review-preflop-workbench">
                    <div className="review-preflop-roster" aria-label="Postflop 位置行动队列">
                      {postflopPlayers.map((player) => (
                        <button
                          aria-label={`${player.position} 状态`}
                          className={[
                            player.position === currentPostflopPosition ? "is-current" : "",
                            player.isHero ? "is-hero" : "",
                            player.status === "folded" ? "is-folded" : "",
                            player.status === "all-in" ? "is-all-in" : "",
                          ].filter(Boolean).join(" ")}
                          disabled
                          key={player.position}
                          type="button"
                        >
                          <strong>{player.position}</strong>
                          <b>{player.stackBb == null ? "-" : formatChips(bbToChipAmount(player.stackBb, activeBigBlindChips))}</b>
                          <small>{[
                            `本街 ${formatChipAmountWithBb(player.streetCommitted, activeBigBlindChips)}`,
                            player.status === "all-in" ? "All-in" : player.status === "folded" ? "已弃牌" : "在池",
                          ].join(" · ")}</small>
                        </button>
                      ))}
                    </div>

                    <div className="review-preflop-actor">
                      {!postflopBoardComplete ? (
                        <div className="review-preflop-complete review-postflop-gate">
                          <span>{REVIEW_STAGE_LABELS[currentPostflopStreet]}</span>
                          <strong>请选择 {requiredBoardCardCount - boardCards.length} 张公共牌</strong>
                        </div>
                      ) : currentPostflopPlayer ? (
                        <>
                          <div className="review-preflop-actor-head">
                            <span>当前行动</span>
                            <strong className={currentPostflopPlayer.isHero ? "is-hero" : undefined}>
                              {currentPostflopPlayer.position}
                            </strong>
                          </div>

                          <div className="review-action-toggle" aria-label="Postflop 行动选择">
                            {postflopCallNeeded > 0 ? (
                              <button
                                className={postflopIntent === "fold" ? "active" : undefined}
                                type="button"
                                onClick={() => {
                                  setPostflopIntent("fold");
                                  setPostflopError("");
                                }}
                              >
                                弃牌
                              </button>
                            ) : (
                              <button
                                className={postflopIntent === "check" ? "active" : undefined}
                                type="button"
                                onClick={() => {
                                  setPostflopIntent("check");
                                  setPostflopError("");
                                }}
                              >
                                过牌
                              </button>
                            )}
                            <button
                              className={postflopIntent === "commit" ? "active" : undefined}
                              type="button"
                              onClick={() => {
                                setPostflopIntent("commit");
                                setPostflopCommitTo(
                                  bbInputToChipInputValue(
                                    postflopDefaultCommitValue(
                                      currentPostflopPlayer,
                                      postflopCurrentBet,
                                      postflopPotBb,
                                      postflopStackBeforeValue,
                                    ),
                                    activeBigBlindChips,
                                  ),
                                );
                                setPostflopError("");
                              }}
                            >
                              {isPostflopCoveredAllIn ? "跟注" : postflopCallNeeded > 0 ? "跟注 / 加注" : "下注"}
                            </button>
                          </div>

                          {postflopIntent === "commit" ? (
                            <>
                              <div className="review-preflop-inputs">
                                <label>
                                  <span>行动前筹码</span>
                                  <input
                                    min="0"
                                    step="1"
                                    type="number"
                                    value={postflopStackBefore}
                                    onChange={(event) => {
                                      const nextStackBefore = event.target.value;
                                      const nextStackBeforeBb = chipAmountToBb(parseFilledChipInput(nextStackBefore), activeBigBlindChips);
                                      setPostflopStackBefore(nextStackBefore);

                                      if (postflopIntent === "commit") {
                                        setPostflopCommitTo(
                                          bbInputToChipInputValue(
                                            postflopDefaultCommitValue(
                                              currentPostflopPlayer,
                                              postflopCurrentBet,
                                              postflopPotBb,
                                              nextStackBeforeBb,
                                            ),
                                            activeBigBlindChips,
                                          ),
                                        );
                                      }
                                    }}
                                  />
                                </label>
                                <label className="review-commit-field">
                                  <span>本街总投入</span>
                                  <input
                                    disabled={isPostflopCommitInputDisabled}
                                    max={postflopMaxCommitTo == null ? undefined : bbToChipInputValue(postflopMaxCommitTo, activeBigBlindChips)}
                                    min={bbToChipInputValue(postflopEffectiveMinimumCommit, activeBigBlindChips)}
                                    step="1"
                                    type="number"
                                    value={postflopCommitToInputValue}
                                    onChange={(event) => {
                                      const nextCommit = event.target.value;
                                      const nextCommitValue = chipAmountToBb(parseFilledChipInput(nextCommit), activeBigBlindChips);

                                      setPostflopCommitTo(
                                        nextCommitValue != null && postflopMaxCommitTo != null && nextCommitValue > postflopMaxCommitTo
                                          ? bbToChipInputValue(postflopMaxCommitTo, activeBigBlindChips)
                                          : nextCommit,
                                      );
                                    }}
                                  />
                                </label>
                                <button
                                  aria-label={`All-in 到 ${postflopMaxCommitTo == null ? "-" : formatChipAmountWithBb(postflopMaxCommitTo, activeBigBlindChips)}`}
                                  className="review-all-in-button"
                                  disabled={!canPostflopAllIn}
                                  type="button"
                                  onClick={fillPostflopAllIn}
                                >
                                  All-in
                                </button>
                              </div>
                              <label className="review-action-note-field">
                                <span>{currentPostflopPlayer.isHero ? "我的想法" : "玩家画像"}</span>
                                <textarea
                                  rows={4}
                                  value={actionNoteValue(currentPostflopPlayer, currentPostflopStreet)}
                                  onChange={(event) => updateActionNote(currentPostflopPlayer, currentPostflopStreet, event.target.value)}
                                />
                              </label>
                            </>
                          ) : null}

                          {postflopError ? <p className="review-preflop-error">{postflopError}</p> : null}

                          <button className="review-preflop-apply" type="button" onClick={applyPostflopAction}>
                            确认行动
                          </button>
                        </>
                      ) : (
                        <div className="review-preflop-complete">
                          <span>{REVIEW_STAGE_LABELS[currentPostflopStreet]} 完成</span>
                          <strong>{postflopPlayers.filter((player) => player.status !== "folded").map((player) => player.position).join(" / ")}</strong>
                        </div>
                      )}
                    </div>

                    <div className="review-preflop-log" aria-label="Postflop 行动线预览">
                      <ol ref={postflopLogRef}>
                        {postflopActions.length ? (
                          postflopActions.map((action) => (
                            <li key={action.id}>
                              <span>{formatPostflopAction(action, activeBigBlindChips)}</span>
                              <b>{formatChipAmountWithBb(action.potAfterBb, activeBigBlindChips)}</b>
                            </li>
                          ))
                        ) : (
                          <li className="is-empty">
                            <span>{postflopBoardComplete ? "等待第一步行动" : "等待公共牌"}</span>
                            <b>{formatChipAmountWithBb(postflopPotBb, activeBigBlindChips)}</b>
                          </li>
                        )}
                      </ol>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>

          <div className="review-create-actions">
            {reviewCreateStage === "hand" ? (
              <button className="secondary" type="button" onClick={closeReviewCreateModal}>
                取消
              </button>
            ) : reviewCreateStage === "preflop" ? (
              <>
                <button className="secondary" type="button" disabled={!preflopHistory.length} onClick={undoPreflopAction}>
                  上一步
                </button>
                <button className="secondary" type="button" onClick={resetPreflopWithConfirm}>
                  重置
                </button>
              </>
            ) : (
              <>
                <button className="secondary" type="button" onClick={returnToPreviousReviewStage}>
                  {previousReviewStageLabel}
                </button>
                <button className="secondary" type="button" onClick={resetCurrentPostflopStreet}>
                  重置{REVIEW_STAGE_LABELS[currentPostflopStreet]}
                </button>
              </>
            )}
            {reviewCreateStage !== "hand" ? (
              <button className="secondary" type="button" onClick={restartHeroHandSelection}>
                重新选择手牌
              </button>
            ) : null}
            <button type="button" disabled={isReviewSaving} onClick={enterNextReviewStage}>
              {isReviewSaving ? "保存中" : nextReviewStageLabel}
            </button>
          </div>
        </section>
      </div>
    ) : null}
    {reviewDraftConfirm ? (
      <div
        className="record-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="review-draft-confirm-title"
        aria-describedby="review-draft-confirm-message"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeReviewDraftConfirm();
        }}
      >
        <div className="record-confirm-card review-draft-confirm-card">
          <div className="record-confirm-copy">
            <div className="record-confirm-heading">
              <div className="record-confirm-mark" aria-hidden="true">!</div>
              <strong id="review-draft-confirm-title">{reviewDraftConfirm.title}</strong>
            </div>
            <p id="review-draft-confirm-message">{reviewDraftConfirm.message}</p>
          </div>

          <div className="record-confirm-actions">
            <button
              className="secondary"
              type="button"
              onClick={closeReviewDraftConfirm}
            >
              {reviewDraftConfirm.cancelLabel}
            </button>
            <button type="button" onClick={confirmReviewDraftAction}>
              {reviewDraftConfirm.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {reviewDeleteTarget ? (
      <div
        className="record-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="review-delete-confirm-title"
        aria-describedby="review-delete-confirm-message"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeReviewDeleteConfirm();
        }}
      >
        <div className="record-confirm-card">
          <div className="record-confirm-copy">
            <div className="record-confirm-heading">
              <div className="record-confirm-mark" aria-hidden="true">!</div>
              <strong id="review-delete-confirm-title">删除这条复盘？</strong>
            </div>
            <p id="review-delete-confirm-message">「{reviewDeleteTarget.heroHand}」会从复盘列表里删除。</p>
          </div>

          <div className="record-confirm-actions">
            <button
              className="secondary"
              disabled={Boolean(deletingReviewId)}
              type="button"
              onClick={closeReviewDeleteConfirm}
            >
              先保留
            </button>
            <button
              disabled={Boolean(deletingReviewId)}
              type="button"
              onClick={deleteReviewFromList}
            >
              {deletingReviewId ? "删除中" : "确认删除"}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
