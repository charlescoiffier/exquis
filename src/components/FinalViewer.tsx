"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Direction, Joint } from "@/lib/images/geometry";
import { LABEL_FONT_SIZE, exportLayout } from "@/lib/images/export-layout";

type Segment = { rank: number; author: string; start: number; end: number };
type Props = { gameId: string; direction: Direction; width: number; height: number; joints: Joint[]; segments: Segment[] };

const FONT = `${LABEL_FONT_SIZE}px system-ui, -apple-system, "Segoe UI", sans-serif`;

export function FinalViewer({ gameId, direction, width, height, joints, segments }: Props) {
  const [showGuides, setShowGuides] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);
  const src = `/api/games/${gameId}/final/image`;
  const layout = useMemo(
    () => exportLayout({ direction, width, height, joints, segments, showGuides }),
    [direction, width, height, joints, segments, showGuides],
  );

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function download() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = "anonymous";
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("load"));
        i.src = src;
      });
      const l = layout;
      const canvas = document.createElement("canvas");
      canvas.width = l.canvasWidth;
      canvas.height = l.canvasHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("ctx");
      if (showGuides) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, l.imageX, l.imageY);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#e11d48";
      ctx.setLineDash([14, 10]);
      for (const j of l.joints) {
        ctx.beginPath();
        ctx.moveTo(j.x1, j.y1);
        ctx.lineTo(j.x2, j.y2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (const r of l.rails) {
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(r.line.x1, r.line.y1);
        ctx.lineTo(r.line.x2, r.line.y2);
        ctx.stroke();
        ctx.save();
        ctx.translate(r.label.x, r.label.y);
        if (r.rotation) ctx.rotate((r.rotation * Math.PI) / 180);
        ctx.fillStyle = "#1f1b16";
        ctx.fillText(r.text, 0, 0);
        ctx.restore();
      }
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("blob");
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const a = document.createElement("a");
      a.href = url;
      a.download = showGuides ? "oeuvre-finale-jointures-noms.png" : "oeuvre-finale.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        if (urlRef.current === url) {
          URL.revokeObjectURL(url);
          urlRef.current = null;
        }
      }, 10_000);
    } catch {
      setMessage("Impossible de préparer le PNG (image indisponible ou export refusé par le navigateur). Réessayez ou rechargez la page.");
    } finally {
      setBusy(false);
    }
  }

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
        Afficher avec jointures et noms
      </label>
      <p>
        <button type="button" onClick={download} disabled={busy}>Télécharger en PNG</button>
      </p>
      {message && <p role="alert" className="error">{message}</p>}
      <div
        data-testid="final-frame"
        style={{ position: "relative", maxWidth: direction === "down" ? 480 : "100%", aspectRatio: `${layout.canvasWidth} / ${layout.canvasHeight}`, background: "#fff" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Œuvre finale"
          style={{
            position: "absolute",
            left: pct(layout.imageX, layout.canvasWidth),
            top: pct(layout.imageY, layout.canvasHeight),
            width: pct(width, layout.canvasWidth),
            height: pct(height, layout.canvasHeight),
            display: "block",
          }}
        />
        {showGuides && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          >
            {layout.joints.map((j, k) => (
              <line key={k} x1={j.x1} y1={j.y1} x2={j.x2} y2={j.y2} stroke="#e11d48" strokeWidth={3} strokeDasharray="14 10" />
            ))}
            {layout.rails.map((r) => (
              <g key={r.rank}>
                <line x1={r.line.x1} y1={r.line.y1} x2={r.line.x2} y2={r.line.y2} stroke={r.color} strokeWidth={6} />
                <text
                  x={r.label.x}
                  y={r.label.y}
                  textAnchor="middle"
                  fontSize={LABEL_FONT_SIZE}
                  fill="#1f1b16"
                  style={{ fontFamily: "system-ui, sans-serif" }}
                  transform={r.rotation ? `rotate(${r.rotation} ${r.label.x} ${r.label.y})` : undefined}
                >
                  {r.text}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
