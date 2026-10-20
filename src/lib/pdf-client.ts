// Browser-only helpers that render PDF pages with pdf.js. pdf.js is loaded on
// first use, so pages without PDFs never download it.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

const MAX_CACHED_DOCUMENTS = 12;
const MAX_CANVAS_SIDE = 4096;

let pdfjsPromise: Promise<PdfJs> | null = null;
type CachedDocument = { promise: Promise<PDFDocumentProxy>; task?: PDFDocumentLoadingTask };
const documentCache = new Map<string, CachedDocument>();

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist")
      .then((pdfjs) => {
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(
            new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
            { type: "module" },
          );
        }
        return pdfjs;
      })
      .catch((error) => {
        pdfjsPromise = null;
        throw error;
      });
  }
  return pdfjsPromise;
}

/**
 * Loads a PDF once per URL and shares it between the chat thumbnail and the
 * viewer. The file is fetched with a plain GET: in production the download
 * route redirects to R2, whose CORS rules allow GET without extra headers.
 */
export function loadPdfDocument(url: string) {
  const cached = documentCache.get(url);
  if (cached) return cached.promise;

  const entry = {} as CachedDocument;
  entry.promise = (async () => {
    const pdfjs = await loadPdfJs();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`PDF request failed with ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    entry.task = pdfjs.getDocument({ data });
    return entry.task.promise;
  })();

  documentCache.set(url, entry);
  entry.promise.catch(() => documentCache.delete(url));

  if (documentCache.size > MAX_CACHED_DOCUMENTS) {
    const [oldestUrl, oldest] = documentCache.entries().next().value!;
    documentCache.delete(oldestUrl);
    // Give renders that are still using it time to finish.
    window.setTimeout(() => {
      oldest.task?.destroy().catch(() => {});
    }, 30_000);
  }

  return entry.promise;
}

/** Page width divided by height, from the page's own size. */
export async function pdfPageAspect(doc: PDFDocumentProxy, pageNumber: number) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return viewport.width / viewport.height;
}

/**
 * Draws one page into the canvas at `cssWidth` CSS pixels wide, sharp on
 * high-density screens. Returns the render task so callers can cancel it.
 */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<RenderTask> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const scale = Math.min(
    (cssWidth * pixelRatio) / base.width,
    MAX_CANVAS_SIDE / Math.max(base.width, base.height),
  );
  const viewport = page.getViewport({ scale });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.aspectRatio = `${base.width} / ${base.height}`;

  return page.render({ canvas, viewport });
}
