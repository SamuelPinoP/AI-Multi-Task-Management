export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-2 right-2 z-40 flex items-center gap-1 rounded-2xl border border-line bg-surface/90 p-1 text-ink shadow-lg shadow-zinc-950/10 backdrop-blur sm:bottom-auto sm:right-3 sm:top-3 sm:flex-col sm:p-1.5">
      <button type="button" onClick={onZoomIn} className={zoomButtonClass} aria-label="Zoom in">
        +
      </button>
      <div className="rounded-lg px-1 py-1 text-[0.65rem] font-bold tabular-nums text-muted">{Math.round(zoom * 100)}%</div>
      <button type="button" onClick={onZoomOut} className={zoomButtonClass} aria-label="Zoom out">
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg px-2 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-muted transition hover:bg-surface-hover hover:text-ink sm:mt-1"
        aria-label="Reset zoom"
      >
        Reset
      </button>
    </div>
  );
}

const zoomButtonClass =
  "flex h-7 w-7 items-center justify-center rounded-xl border border-line bg-surface text-sm font-black shadow-sm transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/40 sm:h-8 sm:w-8 sm:text-base";
