"use client";
import { useEffect, useState } from "react";

/** « 23:41 » ou « 1:02:03 » : chiffres tabulaires, la largeur ne bouge pas à chaque seconde. */
function clock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export function Countdown({ deadline, getNow = Date.now }: { deadline: string; getNow?: () => number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((new Date(deadline).getTime() - getNow()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, getNow]);
  if (left === null) return null;
  return (
    <p className={`countdown${left < 60 ? " countdown-urgent" : ""}`}>
      <span className="countdown-label">Temps restant</span>
      <span className="countdown-time">{left === 0 ? "terminé" : clock(left)}</span>
    </p>
  );
}
