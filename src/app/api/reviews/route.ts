import { get, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import type {
  ReviewHandSpot,
  ReviewPlayerProfile,
  ReviewStreet,
  ReviewStreetAction,
  ReviewStreetBetSize,
  ReviewStreetPlayerStack,
} from "@/app/lib/longgrind";

const REVIEWS_BLOB_PATHNAME = "data/review.json";
const REVIEW_STATUSES: ReviewHandSpot["status"][] = ["待复盘", "已标记", "已吸收"];
const REVIEW_STREETS: ReviewStreet["street"][] = ["Preflop", "Flop", "Turn", "River"];
const REVIEW_STREET_ACTIONS: ReviewStreetAction["action"][] = [
  "fold",
  "check",
  "call",
  "open",
  "bet",
  "raise",
  "jam",
];

export const dynamic = "force-dynamic";

type ReviewsSnapshot = {
  reviews: ReviewHandSpot[];
  etag: string | null;
};

type ReviewPatch = {
  id: string;
  review: Record<string, unknown>;
};

type ReviewDelete = {
  id: string;
};

class ReviewNotFoundError extends Error {}

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

function isReviewStatus(value: unknown): value is ReviewHandSpot["status"] {
  return REVIEW_STATUSES.includes(value as ReviewHandSpot["status"]);
}

function isReviewStreetName(value: unknown): value is ReviewStreet["street"] {
  return REVIEW_STREETS.includes(value as ReviewStreet["street"]);
}

function isReviewStreetAction(value: unknown): value is ReviewStreetAction["action"] {
  return REVIEW_STREET_ACTIONS.includes(value as ReviewStreetAction["action"]);
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function normalizePlayerProfile(value: unknown): ReviewPlayerProfile | null {
  if (!isObject(value) || typeof value.position !== "string" || typeof value.profile !== "string") {
    return null;
  }

  return {
    position: value.position,
    profile: value.profile,
  };
}

function normalizePlayerStack(value: unknown): ReviewStreetPlayerStack | null {
  if (!isObject(value) || typeof value.position !== "string" || typeof value.stack !== "string") {
    return null;
  }

  if (value.isHero !== undefined && typeof value.isHero !== "boolean") return null;

  return {
    position: value.position,
    stack: value.stack,
    ...(value.isHero !== undefined ? { isHero: value.isHero } : {}),
  };
}

function normalizeBetSize(value: unknown): ReviewStreetBetSize | null {
  if (!isObject(value) || !isFiniteNumber(value.amountBb) || !isFiniteNumber(value.potBb)) {
    return null;
  }

  if (value.amountChips !== undefined && !isFiniteNumber(value.amountChips)) {
    return null;
  }

  if (value.potChips !== undefined && !isFiniteNumber(value.potChips)) {
    return null;
  }

  return {
    amountBb: value.amountBb,
    potBb: value.potBb,
    ...(value.amountChips !== undefined ? { amountChips: value.amountChips } : {}),
    ...(value.potChips !== undefined ? { potChips: value.potChips } : {}),
  };
}

function normalizeReviewAction(value: unknown): ReviewStreetAction | null {
  if (
    !isObject(value) ||
    !isReviewStreetAction(value.action) ||
    typeof value.position !== "string" ||
    !value.position.trim()
  ) {
    return null;
  }

  if (value.isAllIn !== undefined && typeof value.isAllIn !== "boolean") return null;

  const optionalNumberFields = [
    "amountBb",
    "amountChips",
    "addedBb",
    "addedChips",
    "committedBb",
    "committedChips",
    "potBeforeBb",
    "potBeforeChips",
    "potAfterBb",
    "potAfterChips",
    "stackBeforeBb",
    "stackBeforeChips",
    "stackAfterBb",
    "stackAfterChips",
  ] as const;

  if (optionalNumberFields.some((field) => value[field] !== undefined && !isFiniteNumber(value[field]))) {
    return null;
  }

  return {
    action: value.action as ReviewStreetAction["action"],
    position: value.position,
    ...(value.amountBb !== undefined ? { amountBb: value.amountBb as number } : {}),
    ...(value.amountChips !== undefined ? { amountChips: value.amountChips as number } : {}),
    ...(value.addedBb !== undefined ? { addedBb: value.addedBb as number } : {}),
    ...(value.addedChips !== undefined ? { addedChips: value.addedChips as number } : {}),
    ...(value.committedBb !== undefined ? { committedBb: value.committedBb as number } : {}),
    ...(value.committedChips !== undefined ? { committedChips: value.committedChips as number } : {}),
    ...(value.potBeforeBb !== undefined ? { potBeforeBb: value.potBeforeBb as number } : {}),
    ...(value.potBeforeChips !== undefined ? { potBeforeChips: value.potBeforeChips as number } : {}),
    ...(value.potAfterBb !== undefined ? { potAfterBb: value.potAfterBb as number } : {}),
    ...(value.potAfterChips !== undefined ? { potAfterChips: value.potAfterChips as number } : {}),
    ...(value.stackBeforeBb !== undefined ? { stackBeforeBb: value.stackBeforeBb as number } : {}),
    ...(value.stackBeforeChips !== undefined ? { stackBeforeChips: value.stackBeforeChips as number } : {}),
    ...(value.stackAfterBb !== undefined ? { stackAfterBb: value.stackAfterBb as number } : {}),
    ...(value.stackAfterChips !== undefined ? { stackAfterChips: value.stackAfterChips as number } : {}),
    ...(value.isAllIn !== undefined ? { isAllIn: value.isAllIn as boolean } : {}),
  };
}

function normalizeReviewStreet(value: unknown): ReviewStreet | null {
  if (!isObject(value)) return null;

  const playerStacks = Array.isArray(value.playerStacks)
    ? value.playerStacks.map(normalizePlayerStack)
    : null;
  const betSizes = value.betSizes === undefined
    ? undefined
    : Array.isArray(value.betSizes)
      ? value.betSizes.map(normalizeBetSize)
      : null;
  const actions = value.actions === undefined
    ? undefined
    : Array.isArray(value.actions)
      ? value.actions.map(normalizeReviewAction)
      : null;

  if (
    !isReviewStreetName(value.street) ||
    typeof value.board !== "string" ||
    typeof value.actionLine !== "string" ||
    (actions !== undefined && (actions === null || actions.some((action) => !action))) ||
    (betSizes !== undefined && (betSizes === null || betSizes.some((betSize) => !betSize))) ||
    (value.potBb !== undefined && !isFiniteNumber(value.potBb)) ||
    !playerStacks ||
    playerStacks.some((playerStack) => !playerStack) ||
    typeof value.myThought !== "string" ||
    typeof value.gtoThought !== "string"
  ) {
    return null;
  }

  return {
    street: value.street,
    board: value.board,
    actionLine: value.actionLine,
    ...(actions !== undefined ? { actions: actions as ReviewStreetAction[] } : {}),
    ...(betSizes !== undefined ? { betSizes: betSizes as ReviewStreetBetSize[] } : {}),
    ...(value.potBb !== undefined ? { potBb: value.potBb } : {}),
    playerStacks: playerStacks as ReviewStreetPlayerStack[],
    myThought: value.myThought,
    gtoThought: value.gtoThought,
  };
}

function normalizeReviewStreetSet(streets: ReviewStreet[]) {
  if (streets.length !== REVIEW_STREETS.length) return null;

  const streetByName = new Map<ReviewStreet["street"], ReviewStreet>();
  for (const street of streets) {
    if (streetByName.has(street.street)) return null;
    streetByName.set(street.street, street);
  }

  if (REVIEW_STREETS.some((streetName) => !streetByName.has(streetName))) {
    return null;
  }

  return REVIEW_STREETS.map((streetName) => streetByName.get(streetName) as ReviewStreet);
}

function normalizeReviewSpot(value: unknown): ReviewHandSpot | null {
  if (!isObject(value) || !isObject(value.board)) return null;

  const playerProfiles = Array.isArray(value.playerProfiles)
    ? value.playerProfiles.map(normalizePlayerProfile)
    : null;
  const tags = normalizeStringArray(value.tags);
  const streetItems = Array.isArray(value.streets)
    ? value.streets.map(normalizeReviewStreet)
    : null;
  const streets = streetItems && !streetItems.some((street) => !street)
    ? normalizeReviewStreetSet(streetItems as ReviewStreet[])
    : null;

  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.heroHand !== "string" ||
    typeof value.heroPosition !== "string" ||
    typeof value.opponentPosition !== "string" ||
    typeof value.opponentProfile !== "string" ||
    !playerProfiles ||
    playerProfiles.some((playerProfile) => !playerProfile) ||
    typeof value.effectiveStack !== "string" ||
    typeof value.potType !== "string" ||
    typeof value.potSize !== "string" ||
    typeof value.board.flop !== "string" ||
    typeof value.board.turn !== "string" ||
    typeof value.board.river !== "string" ||
    typeof value.issue !== "string" ||
    !isReviewStatus(value.status) ||
    !isFiniteNumber(value.evLossBb) ||
    !tags ||
    !streets ||
    typeof value.mistake !== "string" ||
    typeof value.gtoSummary !== "string" ||
    typeof value.takeaway !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    heroHand: value.heroHand,
    heroPosition: value.heroPosition,
    opponentPosition: value.opponentPosition,
    opponentProfile: value.opponentProfile,
    playerProfiles: playerProfiles as ReviewPlayerProfile[],
    effectiveStack: value.effectiveStack,
    potType: value.potType,
    potSize: value.potSize,
    board: {
      flop: value.board.flop,
      turn: value.board.turn,
      river: value.board.river,
    },
    issue: value.issue,
    status: value.status,
    evLossBb: value.evLossBb,
    tags,
    streets: streets as ReviewStreet[],
    mistake: value.mistake,
    gtoSummary: value.gtoSummary,
    takeaway: value.takeaway,
  };
}

function reviewsFromJson(value: unknown): ReviewHandSpot[] {
  const reviews = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.reviews)
      ? value.reviews
      : null;

  if (!reviews) {
    throw new Error("Review JSON must be an array.");
  }

  const normalizedReviews = reviews.map(normalizeReviewSpot);

  if (normalizedReviews.some((review) => !review)) {
    throw new Error("Review JSON contains an invalid review.");
  }

  return normalizedReviews as ReviewHandSpot[];
}

function reviewDeleteFromJson(value: unknown): ReviewDelete | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return { id: value.id };
}

function reviewPatchFromJson(value: unknown): ReviewPatch | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id.trim() || !isObject(value.review)) {
    return null;
  }

  return {
    id: value.id,
    review: value.review,
  };
}

async function readReviews(): Promise<ReviewsSnapshot> {
  const result = await get(REVIEWS_BLOB_PATHNAME, {
    access: "private",
    useCache: false,
  });

  if (!result || result.statusCode !== 200) {
    return { reviews: [], etag: null };
  }

  const text = await new Response(result.stream).text();
  if (!text.trim()) {
    return { reviews: [], etag: result.blob.etag };
  }

  return {
    reviews: reviewsFromJson(JSON.parse(text)),
    etag: result.blob.etag,
  };
}

async function writeReviews(reviews: ReviewHandSpot[]) {
  return put(REVIEWS_BLOB_PATHNAME, JSON.stringify(reviews, null, 2), {
    access: "private",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
}

async function appendReview(review: ReviewHandSpot) {
  const snapshot = await readReviews();
  const nextReviews = [
    review,
    ...snapshot.reviews.filter((item) => item.id !== review.id),
  ];
  const blob = await writeReviews(nextReviews);
  return { reviews: nextReviews, etag: blob.etag };
}

async function patchReview(patch: ReviewPatch) {
  const snapshot = await readReviews();
  let didPatch = false;
  const nextReviews = snapshot.reviews.map((review) => {
    if (review.id !== patch.id) return review;
    didPatch = true;

    const candidate = normalizeReviewSpot({
      ...review,
      ...patch.review,
      id: review.id,
      board: isObject(patch.review.board) ? patch.review.board : review.board,
    });

    if (!candidate) {
      throw new Error("Invalid review patch payload");
    }

    return candidate;
  });

  if (!didPatch) {
    throw new ReviewNotFoundError();
  }

  const blob = await writeReviews(nextReviews);
  return { reviews: nextReviews, etag: blob.etag };
}

async function deleteReview(reviewDelete: ReviewDelete) {
  const snapshot = await readReviews();
  const nextReviews = snapshot.reviews.filter((review) => review.id !== reviewDelete.id);

  if (nextReviews.length === snapshot.reviews.length) {
    throw new ReviewNotFoundError();
  }

  const blob = await writeReviews(nextReviews);
  return { reviews: nextReviews, etag: blob.etag };
}

export async function GET() {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    return NextResponse.json(await readReviews(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to read reviews", error);
    return jsonError("Review data is not available", 502);
  }
}

export async function POST(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const body = (await request.json()) as { review?: unknown };
    const review = normalizeReviewSpot(body.review);

    if (!review) {
      return jsonError("Invalid review payload", 400);
    }

    return NextResponse.json(await appendReview(review));
  } catch (error) {
    console.error("Failed to save review", error);
    return jsonError("Unable to save review", 502);
  }
}

export async function PATCH(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const patch = reviewPatchFromJson(await request.json());

    if (!patch) {
      return jsonError("Invalid review patch payload", 400);
    }

    return NextResponse.json(await patchReview(patch));
  } catch (error) {
    if (error instanceof ReviewNotFoundError) {
      return jsonError("Review not found", 404);
    }

    console.error("Failed to patch review", error);
    return jsonError("Unable to save review", 502);
  }
}

export async function PUT(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const body = (await request.json()) as unknown;
    const reviews = reviewsFromJson(isObject(body) ? body.reviews : body);
    const blob = await writeReviews(reviews);

    return NextResponse.json({ reviews, etag: blob.etag });
  } catch (error) {
    console.error("Failed to replace reviews", error);
    return jsonError("Unable to save reviews", 502);
  }
}

export async function DELETE(request: Request) {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    const reviewDelete = reviewDeleteFromJson(await request.json());

    if (!reviewDelete) {
      return jsonError("Invalid review delete payload", 400);
    }

    return NextResponse.json(await deleteReview(reviewDelete));
  } catch (error) {
    if (error instanceof ReviewNotFoundError) {
      return jsonError("Review not found", 404);
    }

    console.error("Failed to delete review", error);
    return jsonError("Unable to delete review", 502);
  }
}
