import { cookies } from "next/headers";
import StatsClient from "./StatsClient";
import {
  isStatsView,
  statsViewStorageKey,
} from "./preferences";

export default async function StatsPage() {
  const cookieStore = await cookies();
  const storedView = cookieStore.get(statsViewStorageKey)?.value;
  const initialView = isStatsView(storedView) ? storedView : null;

  return <StatsClient initialView={initialView} />;
}
