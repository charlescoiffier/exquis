"use client";
import { getStroke } from "perfect-freehand";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { floodFill, hexToRgba, isInsideOwnZone, type Op } from "@/lib/drawing/ops";
import { canvasSize, guideLines, guidesSvg, inheritedRect, ownRect, type Direction } from "@/lib/images/geometry";

type Props = { gameId: string; direction: Direction; rank: number; total: number; stripUrl?: string; draft: unknown };
type History = { ops: Op[]; redo: Op[] };

function pathFromStroke(points: number[][]): Path2D {
  const p = new Path2D();
  if (points.length === 0) return p;
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
  p.closePath();
  return p;
}

export function DrawingEditor({ gameId, direction, rank, total, stripUrl, draft }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLImageElement | null>(null);
  const { width, height } = canvasSize(direction);
  const [initial] = useState<Op[]>(() => {
    const ops = (draft as { ops?: unknown } | null)?.ops;
    return Array.isArray(ops) ? (ops as Op[]) : [];
  });
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
  const [stripReady, setStripReady] = useState(rank === 1);
  const [stripError, setStripError] = useState(false);

  // Sauvegarde du brouillon : dernier état en ref, un seul intervalle stable.
  const opsRef = useRef<Op[]>(initial);
  const lastSaved = useRef(JSON.stringify(initial));
  const saving = useRef(false);
  useEffect(() => {
    opsRef.current = ops;
  }, [ops]);

  const saveDraft = useCallback(async () => {
    if (saving.current) return;
    const json = JSON.stringify(opsRef.current);
    if (json === lastSaved.current) return;
    saving.current = true;
    try {
      const res = await fetch(`/api/games/${gameId}/my-turn/draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: opsRef.current }),
        keepalive: json.length < 60000,
      });
      if (res.ok) lastSaved.current = json;
    } catch {
      // échec : réessayé au prochain tick
    } finally {
      saving.current = false;
    }
  }, [gameId]);

  useEffect(() => {
    const id = setInterval(() => void saveDraft(), 5000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void saveDraft();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveDraft]);

  useEffect(() => {
    if (rank === 1 || !stripUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      stripRef.current = img;
      setStripReady(true);
    };
    img.onerror = () => {
      if (!cancelled) setStripError(true);
    };
    img.src = stripUrl;
    return () => {
      cancelled = true;
    };
  }, [rank, stripUrl]);

  const render = useCallback(
    (all: Op[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      if (stripRef.current) {
        const r = inheritedRect(direction);
        ctx.drawImage(stripRef.current, r.left, r.top);
      }
      const own = ownRect(direction);
      ctx.beginPath();
      ctx.rect(rank === 1 ? 0 : own.left, rank === 1 ? 0 : own.top, rank === 1 ? width : own.width, rank === 1 ? height : own.height);
      ctx.clip();
      for (const op of all) {
        if (op.kind === "stroke") {
          const outline = getStroke(op.points, { size: op.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
          ctx.globalAlpha = op.opacity;
          ctx.fillStyle = op.tool === "eraser" ? "#ffffff" : op.color;
          ctx.fill(pathFromStroke(outline));
          ctx.globalAlpha = 1;
        } else {
          const img = ctx.getImageData(0, 0, width, height);
          floodFill(img, op.x, op.y, hexToRgba(op.color));
          ctx.putImageData(img, 0, 0);
        }
      }
      ctx.restore();
    },
    [width, height, direction, rank],
  );

  useEffect(() => {
    if (stripReady) render(current ? [...ops, current] : ops);
  }, [ops, current, stripReady, render]);

  function toCanvas(e: React.PointerEvent): [number, number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) * width) / rect.width, ((e.clientY - rect.top) * height) / rect.height, e.pressure || 0.5];
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!e.isPrimary || e.button !== 0 || !stripReady || currentRef.current) return;
    const [x, y, p] = toCanvas(e);
    if (!isInsideOwnZone(x, y, rank, direction)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
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
    setBusy(true);
    setError(null);
    try {
      const blob: Blob | null = await new Promise((res) => canvasRef.current!.toBlob(res, "image/png"));
      if (!blob) {
        setError("Export impossible.");
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/games/${gameId}/my-turn/submit`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Envoi impossible.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Envoi impossible.");
      setBusy(false);
    }
  }

  const guides = useMemo(() => guidesSvg(direction, width, height, guideLines(direction, rank, total)), [direction, width, height, rank, total]);

  return (
    <div>
      <div role="toolbar" aria-label="Outils de dessin" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button type="button" className={tool === "brush" ? "" : "secondary"} onClick={() => setTool("brush")}>Pinceau</button>
        <button type="button" className={tool === "eraser" ? "" : "secondary"} onClick={() => setTool("eraser")}>Gomme</button>
        <button type="button" className={tool === "fill" ? "" : "secondary"} onClick={() => setTool("fill")}>Pot de peinture</button>
        <input aria-label="Couleur" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 48 }} />
        <input aria-label="Taille" type="range" min={1} max={60} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: 120 }} />
        <input aria-label="Opacité" type="range" min={0.1} max={1} step={0.1} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} style={{ width: 100 }} />
        <button type="button" className="secondary" onClick={undo} disabled={!ops.length}>Annuler</button>
        <button type="button" className="secondary" onClick={redoOp} disabled={!redo.length}>Rétablir</button>
      </div>
      <div style={{ position: "relative", maxWidth: 720, touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          style={{ width: "100%", height: "auto", border: "1px solid var(--line)", background: "#fff", display: "block", touchAction: "none" }}
        />
        {/* Calque de guides : visuel uniquement, jamais exporté */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: guides.replace("<svg ", '<svg style="width:100%;height:100%" ') }} />
      </div>
      {stripError && <p className="error">Impossible de charger la bande du dessin précédent. Rechargez la page.</p>}
      {error && <p className="error">{error}</p>}
      <p><button type="button" onClick={submit} disabled={busy || !stripReady || stripError}>Envoyer mon dessin</button></p>
    </div>
  );
}
