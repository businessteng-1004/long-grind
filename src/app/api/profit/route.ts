import { NextResponse } from "next/server";
import { ensureProfit } from "./store";

export const dynamic = "force-dynamic";

function jsonError(error: string, status = 500) {
  return NextResponse.json({ error }, { status });
}

function hasBlobCredentials() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

export async function GET() {
  if (!hasBlobCredentials()) {
    return jsonError("Missing Blob credentials");
  }

  try {
    return NextResponse.json(await ensureProfit(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to read profit", error);
    return jsonError("Profit data is not available", 502);
  }
}
