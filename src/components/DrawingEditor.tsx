"use client";
import { getStroke } from "perfect-freehand";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { floodFill, hexToRgba, isInsideCanvas, sanitizeOps, type Op } from "@/lib/drawing/ops";
import { clearExpired } from "@/lib/expired-notice";
import { ExpiryDialog } from "./ExpiryDialog";
import type { Expiry, LostKind, SubmitState } from "./TurnEditor";
import { useDraftAutosave } from "@/lib/hooks/useDraftAutosave";
import { canvasSize, guideLines, guidesSvg, inheritedRect, ownRect, type Direction } from "@/lib/images/geometry";

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
  /** Échec réseau d'un envoi : la contribution a pu être enregistrée, le serveur doit trancher. */
  onNetworkFailure: () => void;
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
/** Style du trait. Un `streamline` élevé lisse davantage mais fait traîner la pointe derrière le doigt : on le garde bas. */
/** L'aperçu du trait en cours est dessiné à cette échelle : moins de pixels à rasteriser et à envoyer au GPU, surtout sur smartphone. */
const LIVE_SCALE = 0.5;
const STROKE_STYLE = { thinning: 0.5, smoothing: 0.5, streamline: 0.2 };

function pathFromStroke(points: number[][]): Path2D {
  const p = new Path2D();
  if (points.length === 0) return p;
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
  p.closePath();
  return p;
}

export function DrawingEditor({ gameId, direction, rank, total, stripUrl, draft, expiry, submitState, onLost, onNetworkFailure }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLImageElement | null>(null);
  const { width, height } = canvasSize(direction);
  const [initial] = useState<Op[]>(() => sanitizeOps((draft as { ops?: unknown } | null)?.ops));
  const [history, setHistory] = useState<History>({ ops: initial, redo: [] });
  const { ops, redo } = history;
  // Tracé en cours : points accumulés dans une ref (aucun rendu React par mouvement), dessinés au plus une fois par image.
  const currentRef = useRef<Op | null>(null);
  const opsRef = useRef<Op[]>(initial);
  opsRef.current = ops;
  const liveRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const [tool, setTool] = useState<"brush" | "eraser" | "fill">("brush");
  const [color, setColor] = useState("#1f1b16");
  const [size, setSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const sizeRef = useRef(size);
  sizeRef.current = size;
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

  // Calque des traits (transparent) : la bande héritée reste en dessous, on ne peut donc pas l'effacer.
  // Le calque est reconstruit seulement quand `ops` change (annuler, rétablir, brouillon) ; un nouveau tracé est ajouté sans tout rejouer.
  const userRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const flatRef = useRef<HTMLCanvasElement | null>(null);
  const cachedOps = useRef<Op[]>([]);
  const cacheReady = useRef(false);
  // Le remplissage ne touche jamais la bande héritée (tours 2 et suivants).
  const fillBounds = useMemo(() => (rank === 1 ? { left: 0, top: 0, width, height } : ownRect(direction)), [rank, direction, width, height]);

  const makeLayer = useCallback(() => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }, [width, height]);

  const applyOp = useCallback(
    (ctx: CanvasRenderingContext2D, op: Op) => {
      if (op.kind === "stroke") {
        // La gomme est un peu plus large que le pinceau de même taille : elle emporte aussi la frange adoucie des traits.
        const outline = getStroke(op.points, { size: op.tool === "eraser" ? op.size + 3 : op.size, ...STROKE_STYLE });
        ctx.save();
        ctx.globalAlpha = op.opacity;
        if (op.tool === "eraser") {
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = "#000000";
        } else {
          ctx.fillStyle = op.color;
        }
        ctx.fill(pathFromStroke(outline));
        ctx.restore();
        return;
      }
      // Remplissage : la zone est déterminée sur « fond blanc + calque des traits », limitée à la zone propre,
      // puis seuls les pixels remplis sont ajoutés au calque des traits.
      if (!flatRef.current) flatRef.current = makeLayer();
      const fctx = flatRef.current.getContext("2d", { willReadFrequently: true })!;
      fctx.globalCompositeOperation = "source-over";
      fctx.globalAlpha = 1;
      fctx.fillStyle = "#ffffff";
      fctx.fillRect(0, 0, width, height);
      fctx.drawImage(ctx.canvas, 0, 0);
      const before = fctx.getImageData(0, 0, width, height);
      const after = new ImageData(new Uint8ClampedArray(before.data), width, height);
      const rgba = hexToRgba(op.color);
      floodFill(after, op.x, op.y, rgba, 16, fillBounds);
      const overlay = new ImageData(width, height);
      for (let i = 0; i < after.data.length; i += 4) {
        if (after.data[i] !== before.data[i] || after.data[i + 1] !== before.data[i + 1] || after.data[i + 2] !== before.data[i + 2]) {
          overlay.data[i] = rgba[0];
          overlay.data[i + 1] = rgba[1];
          overlay.data[i + 2] = rgba[2];
          overlay.data[i + 3] = 255;
        }
      }
      fctx.clearRect(0, 0, width, height);
      fctx.putImageData(overlay, 0, 0);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(flatRef.current, 0, 0);
      ctx.restore();
    },
    [width, height, fillBounds, makeLayer],
  );

  const paint = useCallback(
    (committed: Op[], live: Op | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!userRef.current) {
        userRef.current = makeLayer();
        scratchRef.current = makeLayer();
      }
      const user = userRef.current;
      const uctx = user.getContext("2d")!;
      const prev = cachedOps.current;
      const incremental =
        cacheReady.current &&
        committed.length === prev.length + 1 &&
        (prev.length === 0 || committed[prev.length - 1] === prev[prev.length - 1]);
      if (incremental) {
        applyOp(uctx, committed[committed.length - 1]);
      } else if (!(cacheReady.current && committed === prev)) {
        uctx.clearRect(0, 0, width, height);
        for (const op of committed) applyOp(uctx, op);
      }
      cachedOps.current = committed;
      cacheReady.current = true;
      let layer = user;
      if (live && live.kind === "stroke") {
        const scratch = scratchRef.current!;
        const sctx = scratch.getContext("2d")!;
        sctx.clearRect(0, 0, width, height);
        sctx.drawImage(user, 0, 0);
        applyOp(sctx, live);
        layer = scratch;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      if (stripRef.current) {
        const r = inheritedRect(direction);
        ctx.drawImage(stripRef.current, r.left, r.top);
      }
      ctx.drawImage(layer, 0, 0);
      // Le tracé validé est désormais dans le calque : on efface l'aperçu en direct.
      if (!live) liveRef.current?.getContext("2d", { desynchronized: true })?.clearRect(0, 0, width, height);
    },
    [width, height, direction, applyOp, makeLayer],
  );

  useEffect(() => {
    if (stripReady) paint(ops, null);
  }, [ops, stripReady, paint]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /** Dessine le tracé en cours, au plus une fois par image : pinceau sur un calque d'aperçu, gomme par recomposition. */
  function drawLive() {
    rafRef.current = 0;
    const op = currentRef.current;
    if (!op || op.kind !== "stroke") return;
    if (op.tool === "eraser") {
      paint(opsRef.current, op);
      return;
    }
    const live = liveRef.current;
    if (!live) return;
    const lctx = live.getContext("2d", { desynchronized: true })!;
    lctx.setTransform(LIVE_SCALE, 0, 0, LIVE_SCALE, 0, 0);
    lctx.clearRect(0, 0, width, height);
    lctx.fillStyle = op.color;
    lctx.fill(pathFromStroke(getStroke(op.points, { size: op.size, ...STROKE_STYLE })));
  }
  function scheduleLive() {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(drawLive);
  }

  function toCanvas(e: { clientX: number; clientY: number; pressure: number }): [number, number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) * width) / rect.width, ((e.clientY - rect.top) * height) / rect.height, e.pressure || 0.5];
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!e.isPrimary || e.button !== 0 || !stripReady || currentRef.current) return;
    const [x, y, p] = toCanvas(e);
    if (!isInsideCanvas(x, y, direction)) return;
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
    if (liveRef.current) {
      liveRef.current.style.opacity = String(opacity);
      liveRef.current.getContext("2d", { desynchronized: true })?.clearRect(0, 0, width, height);
    }
    moveRing(e);
    scheduleLive();
  }
  // Anneau de taille du pinceau sous le curseur : positionné directement dans le DOM, sans rendu React.
  function moveRing(e: React.PointerEvent<HTMLCanvasElement>) {
    const el = ringRef.current;
    if (!el) return;
    if (e.pointerType === "touch" || tool === "fill") {
      el.style.display = "none";
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const d = Math.max(4, sizeRef.current * (rect.width / width));
    el.style.display = "block";
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.left = `${e.clientX - rect.left}px`;
    el.style.top = `${e.clientY - rect.top}px`;
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    moveRing(e);
    const cur = currentRef.current;
    if (!cur || cur.kind !== "stroke" || !e.isPrimary) return;
    // Les points intermédiaires fusionnés par le navigateur rendent le trait plus fidèle au geste.
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" && native.getCoalescedEvents().length ? native.getCoalescedEvents() : [native];
    for (const ev of events) cur.points.push(toCanvas(ev));
    scheduleLive();
  }
  function endStroke() {
    const cur = currentRef.current;
    if (!cur) return;
    currentRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
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
    let requested = false;
    try {
      const blob: Blob | null = await new Promise((res) => canvasRef.current!.toBlob(res, "image/png"));
      if (!blob) return fail("Export impossible.");
      requested = true;
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
      if (requested) onNetworkFailure();
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
        <div className="toolbar-group toolbar-sliders">
          <div className="slider-field">
            <div className="slider-head">
              <label htmlFor="brush-size" className="slider-label">Taille du pinceau</label>
              <output htmlFor="brush-size">{size} px</output>
            </div>
            <input id="brush-size" type="range" min={1} max={60} value={size} onChange={(e) => setSize(Number(e.target.value))} className="slider" />
          </div>
          <div className="slider-field">
            <div className="slider-head">
              <label htmlFor="brush-opacity" className="slider-label">Opacité du trait</label>
              <output htmlFor="brush-opacity">{Math.round(opacity * 100)} %</output>
            </div>
            <input id="brush-opacity" type="range" min={0.1} max={1} step={0.1} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="slider" />
          </div>
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
          onPointerLeave={() => {
            if (ringRef.current) ringRef.current.style.display = "none";
            endStroke();
          }}
          className="drawing-canvas"
        />
        {/* Aperçu du trait de pinceau en cours (au-dessus de la bande héritée), vidé quand le trait est validé */}
        <canvas ref={liveRef} width={width * LIVE_SCALE} height={height * LIVE_SCALE} className="live-canvas" aria-hidden="true" />
        <div ref={ringRef} className="brush-ring" aria-hidden="true" style={{ display: "none" }} />
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
          busy={busy}
          submitDisabled={!stripReady || stripError}
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
