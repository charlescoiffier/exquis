"use client";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

export function Countdown({ deadline, getNow = Date.now }: { deadline: string; getNow?: () => number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((new Date(deadline).getTime() - getNow()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, getNow]);
  if (left === null) return null;
  return <p className={left < 60 ? "error" : "muted"}>Temps restant : {left === 0 ? "terminé" : formatDuration(left)}</p>;
}
