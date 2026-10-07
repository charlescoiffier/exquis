"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Direction, Joint } from "@/lib/images/geometry";
import { RAIL_COLORS, exportLayout, exportScale } from "@/lib/images/export-layout";

type Segment = { rank: number; author: string; label?: string; start: number; end: number };
type Props = { gameId: string; direction: Direction; width: number; height: number; joints: Joint[]; segments: Segment[] };

const EXPORT_FONT = 40;
const FONT = `${EXPORT_FONT}px system-ui, -apple-system, "Segoe UI", sans-serif`;

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
      // Surface plafonnée (limite des canvas sur iOS) : réduction uniforme, traits et textes compris.
      const scale = exportScale(l.canvasWidth, l.canvasHeight);
      canvas.width = Math.floor(l.canvasWidth * scale);
      canvas.height = Math.floor(l.canvasHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("ctx");
      ctx.scale(scale, scale);
      if (showGuides) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, l.canvasWidth, l.canvasHeight);
      }
      ctx.drawImage(img, l.imageX, l.imageY);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(76, 76, 76, 0.5)";
      ctx.setLineDash([8, 8]);
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

  const down = direction === "down";
  const axisLen = down ? height : width;
  const pc = (v: number) => `${(v / axisLen) * 100}%`;
  // Largeur minimale (horizontal) pour que chaque zone fasse au moins ~72 px à l'écran, plafonnée.
  const minPx = down ? undefined : Math.min(2400, Math.ceil(Math.max(0, ...segments.map((s) => (72 * axisLen) / Math.max(1, s.end - s.start)))));
  const colorOf = (k: number) => RAIL_COLORS[k % RAIL_COLORS.length];
  const labelBase: React.CSSProperties = { position: "absolute", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center", fontSize: 14, lineHeight: "20px", color: "var(--fg)", fontWeight: 700 };

  const rail = showGuides && (
    <div
      data-testid="names-rail"
      style={down ? { position: "relative", width: 34, flex: "none" } : { position: "relative", height: 30 }}
    >
      {/* Aligné sur l'image : le cadre de l'œuvre (bordure de 2 px) est à côté, les noms restent en dehors. */}
      <div style={{ position: "absolute", inset: down ? "2px 0" : "0 2px" }}>
      {segments.map((s, k) => {
        return (
          <div key={s.rank}>
            <div
              aria-hidden="true"
              style={
                down
                  ? { position: "absolute", right: 3, width: 3, top: pc(s.start), height: pc(s.end - s.start), background: colorOf(k) }
                  : { position: "absolute", bottom: 2, height: 3, left: pc(s.start), width: pc(s.end - s.start), background: colorOf(k) }
              }
            />
            <div
              title={s.label ? `${s.author} · ${s.label}` : s.author}
              data-testid="author-label"
              style={
                down
                  ? { ...labelBase, left: 2, width: 22, top: pc(s.start), height: pc(s.end - s.start), writingMode: "vertical-rl", transform: "rotate(180deg)" }
                  : { ...labelBase, top: 2, left: pc(s.start), width: pc(s.end - s.start) }
              }
            >
              {s.label ? `${s.author} · ${s.label}` : s.author}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );

  const image = (
    <div className="final-art" style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Œuvre finale" style={{ width: "100%", height: "auto", display: "block", background: "#fff" }} />
      {showGuides && (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {joints.flatMap((j) => [j.start, j.end]).map((p, k) => (
            <line
              key={k}
              x1={down ? 0 : p}
              x2={down ? width : p}
              y1={down ? p : 0}
              y2={down ? p : height}
              stroke="#4C4C4C"
              strokeOpacity={0.45}
              strokeWidth={1}
              strokeDasharray="6 6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
    </div>
  );

  return (
    <div>
      <div className="final-toolbar">
        <label className="switch">
          <input type="checkbox" role="switch" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span>Afficher avec jointures et noms</span>
        </label>
        <button type="button" onClick={download} disabled={busy}>Télécharger en PNG</button>
      </div>
      {message && <p role="alert" className="notice error">{message}</p>}
      <div data-testid="final-scroll" style={{ maxWidth: down ? 520 : "100%", overflowX: "auto", paddingBottom: 4 }}>
        <div data-testid="final-frame" style={{ minWidth: minPx, display: "flex", flexDirection: down ? "row" : "column", alignItems: "stretch" }}>
          {rail}
          {image}
        </div>
      </div>
    </div>
  );
}
