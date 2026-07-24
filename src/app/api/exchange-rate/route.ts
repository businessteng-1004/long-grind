import { NextResponse } from "next/server";

const FRANKFURTER_USD_CNY_URL = "https://api.frankfurter.dev/v2/rate/USD/CNY";

type FrankfurterRateResponse = {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
};

function jsonError(error: string, status = 500) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  try {
    const response = await fetch(FRANKFURTER_USD_CNY_URL, {
      next: { revalidate: 3600 },
    });
    const data = (await response.json()) as FrankfurterRateResponse;

    if (
      !response.ok ||
      data.base !== "USD" ||
      data.quote !== "CNY" ||
      typeof data.rate !== "number" ||
      !Number.isFinite(data.rate)
    ) {
      return jsonError("Invalid exchange rate response", 502);
    }

    return NextResponse.json(
      {
        base: data.base,
        quote: data.quote,
        rate: data.rate,
        date: data.date ?? null,
      },
      {
        headers: {
          "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch exchange rate", error);
    return jsonError("Unable to fetch exchange rate", 502);
  }
}
