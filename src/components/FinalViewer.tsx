"use client";
import { useMemo, useState } from "react";
import { guidesSvg, type Direction, type Joint } from "@/lib/images/geometry";

type Props = { gameId: string; direction: Direction; width: number; height: number; joints: Joint[] };

export function FinalViewer({ gameId, direction, width, height, joints }: Props) {
  const [showJoints, setShowJoints] = useState(false);
  const svg = useMemo(
    () => guidesSvg(direction, width, height, joints.flatMap((j) => [j.start, j.end])).replace("<svg ", '<svg style="width:100%;height:100%" '),
    [direction, width, height, joints],
  );
  const base = `/api/games/${gameId}/final/image`;

  return (
    <div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={showJoints} onChange={(e) => setShowJoints(e.target.checked)} />
        Afficher les jointures
      </label>
      <p>
        <a href={`${base}?download=1`}>Télécharger le PNG</a> · <a href={`${base}?download=1&guides=1`}>Télécharger avec jointures</a>
      </p>
      <div style={{ position: "relative", maxWidth: direction === "down" ? 480 : "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={base} alt="Œuvre finale" style={{ width: "100%", height: "auto", display: "block" }} />
        {showJoints && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
    </div>
  );
}
