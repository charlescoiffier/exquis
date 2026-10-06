"use client";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

export function Countdown({ deadline }: { deadline: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (left === null) return null;
  return <p className={left < 60 ? "error" : "muted"}>Temps restant : {left === 0 ? "terminé" : formatDuration(left)}</p>;
}
