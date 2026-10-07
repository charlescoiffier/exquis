"use client";
import { getStroke } from "perfect-freehand";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { floodFill, hexToRgba, isInsideOwnZone, sanitizeOps, type Op } from "@/lib/drawing/ops";
import { clearExpired } from "@/lib/expired-notice";
import { ExpiryDialog } from "./ExpiryDialog";
import type { Expiry, LostKind, SubmitState } from "./TurnEditor";
import { useDraftAutosave } from "@/lib/hooks/useDraftAutosave";
import { canvasSize, guideLines, guidesSvg, inheritedRect, type Direction } from "@/lib/images/geometry";

type Props = {
  gameId: string;
  direction: Direction;
  rank: number;
  total: number;
  stripUrl?: string;
  draft: unknown;
  expiry: Expiry;
  submitState: RefObject<SubmitState>;
  onLost: (kind: LostKind) => void;
};
const PALETTE: { name: string; hex: string }[] = [
  { name: "Noir", hex: "#1f1b16" },
  { name: "Gris", hex: "#8a8a8a" },
  { name: "Blanc", hex: "#ffffff" },
  { name: "Rouge", hex: "#e11d48" },
  { name: "Orange", hex: "#f97316" },
  { name: "Jaune", hex: "#facc15" },
  { name: "Vert", hex: "#16a34a" },
  { name: "Turquoise", hex: "#14b8a6" },
  { name: "Bleu", hex: "#2563eb" },
  { name: "Violet", hex: "#7c3aed" },
  { name: "Rose", hex: "#ec4899" },
  { name: "Marron", hex: "#92400e" },
];
type History = { ops: Op[]; redo: Op[] };

function pathFromStroke(points: number[][]): Path2D {
  const p = new Path2D();
  if (points.length === 0) return p;
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
  p.closePath();
  return p;
}

export function DrawingEditor({ gameId, direction, rank, total, stripUrl, draft, expiry, submitState, onLost }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLImageElement | null>(null);
  const { width, height } = canvasSize(direction);
  const [initial] = useState<Op[]>(() => sanitizeOps((draft as { ops?: unknown } | null)?.ops));
  const [history, setHistory] = useState<History>({ ops: initial, redo: [] });
  const { ops, redo } = history;
  const [current, setCurrent] = useState<Op | null>(null);
  const currentRef = useRef<Op | null>(null);
  const [tool, setTool] = useState<"brush" | "eraser" | "fill">("brush");
  const [color, setColor] = useState("#1f1b16");
  const [size, setSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // URL figée pour ce tour : le serveur la re-signe à chaque rendu, un rafraîchissement ne doit pas relancer le téléchargement.
  const [frozenStripUrl] = useState(stripUrl);
  const [stripReady, setStripReady] = useState(rank === 1);
  const [stripError, setStripError] = useState(rank > 1 && !stripUrl);

  // Sauvegarde du brouillon : dernier état en ref, un seul intervalle stable (voir useDraftAutosave).
  useDraftAutosave(gameId, { ops }, { ops: initial });

  useEffect(() => {
    if (rank === 1 || !frozenStripUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      stripRef.current = img;
      setStripReady(true);
    };
    img.onerror = () => {
      if (!cancelled && !stripRef.current) setStripError(true);
    };
    img.src = frozenStripUrl;
    return () => {
      cancelled = true;
    };
  }, [rank, frozenStripUrl]);

  // Cache bitmap des opérations validées (hors canvas visible) : reconstruit seulement quand `ops` change.
  const cacheRef = useRef<HTMLCanvasElement | null>(null);
  const cachedOps = useRef<Op[]>([]);
  const cacheStrip = useRef(false);

  const applyOp = useCallback(
    (ctx: CanvasRenderingContext2D, op: Op) => {
      if (op.kind === "stroke") {
        const outline = getStroke(op.points, { size: op.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
        ctx.save();
        ctx.globalAlpha = op.opacity;
        ctx.fillStyle = op.tool === "eraser" ? "#ffffff" : op.color;
        ctx.fill(pathFromStroke(outline));
        ctx.restore();
      } else {
        // Le remplissage s'étend sur toute la surface, bande héritée comprise.
        const img = ctx.getImageData(0, 0, width, height);
        floodFill(img, op.x, op.y, hexToRgba(op.color), 16);
        ctx.putImageData(img, 0, 0);
      }
    },
    [width, height],
  );

  const paint = useCallback(
    (committed: Op[], live: Op | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!cacheRef.current) {
        cacheRef.current = document.createElement("canvas");
        cacheRef.current.width = width;
        cacheRef.current.height = height;
      }
      const cache = cacheRef.current;
      const cctx = cache.getContext("2d", { willReadFrequently: true })!;
      const prev = cachedOps.current;
      const incremental =
        cacheStrip.current &&
        committed.length === prev.length + 1 &&
        (prev.length === 0 || committed[prev.length - 1] === prev[prev.length - 1]);
      if (incremental) {
        applyOp(cctx, committed[committed.length - 1]);
      } else if (!(cacheStrip.current && committed === prev)) {
        cctx.save();
        cctx.globalAlpha = 1;
        cctx.fillStyle = "#ffffff";
        cctx.fillRect(0, 0, width, height);
        if (stripRef.current) {
          const r = inheritedRect(direction);
          cctx.drawImage(stripRef.current, r.left, r.top);
        }
        cctx.restore();
        for (const op of committed) applyOp(cctx, op);
      }
      cachedOps.current = committed;
      cacheStrip.current = true;
      const ctx = canvas.getContext("2d")!;
      ctx.globalAlpha = 1;
      ctx.drawImage(cache, 0, 0);
      if (live && live.kind === "stroke") {
        const outline = getStroke(live.points, { size: live.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
        ctx.save();
        ctx.globalAlpha = live.opacity;
        ctx.fillStyle = live.tool === "eraser" ? "#ffffff" : live.color;
        ctx.fill(pathFromStroke(outline));
        ctx.restore();
      }
    },
    [width, height, direction, applyOp],
  );

  useEffect(() => {
    if (stripReady) paint(ops, current);
  }, [ops, current, stripReady, paint]);

  function toCanvas(e: React.PointerEvent): [number, number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) * width) / rect.width, ((e.clientY - rect.top) * height) / rect.height, e.pressure || 0.5];
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!e.isPrimary || e.button !== 0 || !stripReady || currentRef.current) return;
    const [x, y, p] = toCanvas(e);
    if (!isInsideOwnZone(x, y, rank, direction)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointeur déjà terminé : on continue sans capture
    }
    if (tool === "fill") {
      setHistory((h) => ({ ops: [...h.ops, { kind: "fill", x, y, color }], redo: [] }));
      return;
    }
    const op: Op = { kind: "stroke", tool, color, size, opacity, points: [[x, y, p]] };
    currentRef.current = op;
    setCurrent(op);
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const cur = currentRef.current;
    if (!cur || cur.kind !== "stroke" || !e.isPrimary) return;
    const [x, y, p] = toCanvas(e);
    const next: Op = { ...cur, points: [...cur.points, [x, y, p]] };
    currentRef.current = next;
    setCurrent(next);
  }
  function endStroke() {
    const cur = currentRef.current;
    if (!cur) return;
    currentRef.current = null;
    setCurrent(null);
    setHistory((h) => ({ ops: [...h.ops, cur], redo: [] }));
  }
  const undo = () =>
    setHistory((h) => (h.ops.length ? { ops: h.ops.slice(0, -1), redo: [...h.redo, h.ops[h.ops.length - 1]] } : h));
  const redoOp = () =>
    setHistory((h) => (h.redo.length ? { ops: [...h.ops, h.redo[h.redo.length - 1]], redo: h.redo.slice(0, -1) } : h));

  async function submit() {
    if (busy) return;
    setBusy(true);
    submitState.current.busy = true;
    setError(null);
    const fail = (message: string) => {
      submitState.current.busy = false;
      setError(message);
      setBusy(false);
    };
    try {
      const blob: Blob | null = await new Promise((res) => canvasRef.current!.toBlob(res, "image/png"));
      if (!blob) return fail("Export impossible.");
      const res = await fetch(`/api/games/${gameId}/my-turn/submit`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "not_your_turn") {
          submitState.current.busy = false;
          onLost("expired");
          return;
        }
        return fail(data.error ?? "Envoi impossible.");
      }
      submitState.current.done = true;
      clearExpired(gameId);
      router.refresh();
    } catch {
      fail("Envoi impossible.");
    }
  }

  const guides = useMemo(() => guidesSvg(direction, width, height, guideLines(direction, rank, total)), [direction, width, height, rank, total]);

  const toolButton = (id: "brush" | "eraser" | "fill", label: string, icon: ReactNode) => (
    <button type="button" className={`tool-btn${tool === id ? "" : " secondary"}`} aria-label={label} aria-pressed={tool === id} title={label} onClick={() => setTool(id)}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">{icon}</svg>
    </button>
  );

  return (
    <div>
      <div role="toolbar" aria-label="Outils de dessin" className="toolbar">
        <div className="toolbar-group">
          {toolButton("brush", "Pinceau", <path d="M4 20c3 0 5-1 5-4l9-9-2-2-9 9c-3 0-3 3-3 6zM15 6l3 3" />)}
          {toolButton("eraser", "Gomme", <path d="M3 17l9-11 8 7-5 6H8zM8 21h12" />)}
          {toolButton("fill", "Pot de peinture", <path d="M5 11l7-7 7 7-7 7zM20 15c1 2 2 3 2 4a2 2 0 0 1-4 0c0-1 1-2 2-4z" />)}
        </div>
        <div className="toolbar-group">
          <button type="button" className="secondary" onClick={undo} disabled={!ops.length}>Annuler</button>
          <button type="button" className="secondary" onClick={redoOp} disabled={!redo.length}>Rétablir</button>
        </div>
        <div role="group" aria-label="Couleur" className="toolbar-group">
          <label className="color-field">
            <span aria-hidden="true" data-testid="active-color" className="color-current" style={{ background: color }} />
            Couleur
            <input aria-label="Couleur libre" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
          </label>
          <div className="palette">
            {PALETTE.map((c) => {
              const active = c.hex.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  aria-label={c.name}
                  aria-pressed={active}
                  title={c.name}
                  onClick={() => setColor(c.hex)}
                  className="palette-swatch"
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
        </div>
        <div className="toolbar-group">
          <input aria-label="Taille" type="range" min={1} max={60} value={size} onChange={(e) => setSize(Number(e.target.value))} className="slider" />
          <input aria-label="Opacité" type="range" min={0.1} max={1} step={0.1} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="slider slider-opacity" />
        </div>
      </div>
      {/* Le cadre est sur l'enveloppe : une bordure sur le canvas fausserait la conversion des coordonnées du pointeur. */}
      <div className="canvas-frame">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          className="drawing-canvas"
        />
        {/* Calque de guides : visuel uniquement, jamais exporté */}
        <div className="guides-layer" dangerouslySetInnerHTML={{ __html: guides.replace("<svg ", '<svg style="width:100%;height:100%" ') }} />
      </div>
      {stripError && <p className="error">Impossible de charger la bande du dessin précédent. Rechargez la page.</p>}
      {error && <p className="error">{error}</p>}
      {expiry.active && (
        <ExpiryDialog
          question="Temps écoulé. Valider votre dessin maintenant ?"
          submitLabel="Envoyer mon dessin"
          expiresAtMs={expiry.expiresAtMs}
          getNow={expiry.getNow}
          busy={busy || !stripReady || stripError}
          error={error}
          onSubmit={submit}
          onAbandon={() => onLost("abandoned")}
        />
      )}
      <div className="turn-actions">
        <button type="button" onClick={submit} disabled={busy || !stripReady || stripError}>Envoyer mon dessin</button>
      </div>
    </div>
  );
}
