import type { Metadata } from "next";
import { ArenaRunner } from "@/components/arena-runner";

export const metadata: Metadata = {
  title: "Arena — one question, no answer key",
  description:
    "A benchmark instance computed when you open the page. An agent with WebMCP searches and reads its way to the answer, and every step is shown.",
};

// The point of the page is that this instance did not exist before you asked
// for it, so it must not be served from a cache.
export const dynamic = "force-dynamic";

export default async function ArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; hops?: string }>;
}) {
  const sp = await searchParams;
  const seed = Number.isFinite(Number(sp.seed))
    ? Math.trunc(Number(sp.seed))
    : Math.floor(Math.random() * 1_000_000);
  const hops = Math.min(6, Math.max(2, Math.trunc(Number(sp.hops)) || 3));

  return <ArenaRunner seed={seed} hops={hops} />;
}
