import type { CaseInputFile } from "./fetch-task";

interface PdfTextPage {
  page: number;
  text: string;
}

interface LoadedPdf {
  pages: number;
  text(page: number): Promise<string>;
  allText(): Promise<PdfTextPage[]>;
  image(page: number, scale?: number): Promise<PdfImage>;
  region(page: number, region: PdfRenderRegion, scale?: number): Promise<PdfImage>;
}

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(input: { data: Uint8Array }): { promise: Promise<PdfDocument> };
};

type PdfDocument = {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
};

type PdfPage = {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
  getViewport(input: { scale: number }): { width: number; height: number };
  render(input: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
};

const compact = (s: string) => s.replace(/\s+/g, " ").trim();
const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const MAX_IMAGE_PIXELS = 9_000_000;

interface PdfImage {
  width: number;
  height: number;
  scale: number;
  image_data_url: string;
}

export interface PdfRenderRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const normalizeScale = (scale: number | undefined) => {
  if (scale === undefined || Number.isNaN(scale)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

const assertPage = (page: number, pages: number) => {
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    throw new Error(`page must be between 1 and ${pages}`);
  }
};

const assertRegion = (region: PdfRenderRegion) => {
  const values = [region.x, region.y, region.width, region.height];
  if (!values.every(Number.isFinite)) throw new Error("region must use finite numbers");
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0) {
    throw new Error("region must have positive size and non-negative origin");
  }
  if (region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error("region uses page-relative coordinates from 0 to 1");
  }
};

const canvasFor = (width: number, height: number) => {
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error("rendered page is too large; use a smaller scale or render a region");
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot render PDF pages");
  return { canvas, ctx };
};

function snippet(text: string, terms: string[], width = 180): string {
  const hay = text.toLowerCase();
  const found = terms
    .map((term) => ({ term, at: hay.indexOf(term) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  const at = found?.at ?? -1;
  if (at === -1) return compact(text).slice(0, width);
  const needle = found?.term ?? "";
  const start = Math.max(0, at - Math.floor(width / 2));
  const end = Math.min(text.length, at + needle.length + Math.floor(width / 2));
  return `${start > 0 ? "..." : ""}${compact(text.slice(start, end))}${end < text.length ? "..." : ""}`;
}

export function createPdfReader(files: () => CaseInputFile[]) {
  const cache = new Map<string, Promise<LoadedPdf>>();

  const load = (file: CaseInputFile): Promise<LoadedPdf> => {
    const hit = cache.get(file.id);
    if (hit) return hit;

    const promise = (async () => {
      const pdfjs = (await import("pdfjs-dist")) as PdfJs;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`could not read ${file.name} (${res.status})`);
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
      const pages = new Map<number, Promise<string>>();
      const rendered = new Map<string, Promise<PdfImage>>();

      const text = async (page: number) => {
        assertPage(page, doc.numPages);
        const hit = pages.get(page);
        if (hit) return hit;
        const pageText = (async () => {
          const p = await doc.getPage(page);
          const content = await p.getTextContent();
          return compact(content.items.map((item) => item.str ?? "").join(" "));
        })();
        pages.set(page, pageText);
        return pageText;
      };

      const image = async (page: number, rawScale?: number) => {
        assertPage(page, doc.numPages);
        const scale = normalizeScale(rawScale);
        const key = `${page}:${scale}`;
        const hit = rendered.get(key);
        if (hit) return hit;
        const pageImage = (async () => {
          const p = await doc.getPage(page);
          const viewport = p.getViewport({ scale });
          const { canvas, ctx } = canvasFor(viewport.width, viewport.height);
          await p.render({ canvasContext: ctx, viewport }).promise;
          return {
            width: canvas.width,
            height: canvas.height,
            scale,
            image_data_url: canvas.toDataURL("image/png"),
          };
        })();
        rendered.set(key, pageImage);
        return pageImage;
      };

      const region = async (page: number, rawRegion: PdfRenderRegion, rawScale?: number) => {
        assertRegion(rawRegion);
        assertPage(page, doc.numPages);
        const scale = normalizeScale(rawScale);
        const p = await doc.getPage(page);
        const viewport = p.getViewport({ scale });
        const sx = Math.floor(viewport.width * rawRegion.x);
        const sy = Math.floor(viewport.height * rawRegion.y);
        const sw = Math.max(1, Math.ceil(viewport.width * rawRegion.width));
        const sh = Math.max(1, Math.ceil(viewport.height * rawRegion.height));
        const { canvas, ctx } = canvasFor(sw, sh);
        ctx.save();
        try {
          ctx.translate(-sx, -sy);
          await p.render({ canvasContext: ctx, viewport }).promise;
        } finally {
          ctx.restore();
        }
        return {
          width: canvas.width,
          height: canvas.height,
          scale,
          image_data_url: canvas.toDataURL("image/png"),
        };
      };

      return {
        pages: doc.numPages,
        text,
        image,
        region,
        allText: async () => {
          const out: PdfTextPage[] = [];
          for (let page = 1; page <= doc.numPages; page += 1) {
            out.push({ page, text: await text(page) });
          }
          return out;
        },
      };
    })();

    cache.set(file.id, promise);
    return promise;
  };

  const find = (caseId: string, fileId: string) => {
    const file = files().find((f) => f.id === fileId && f.path.includes(`/${caseId}/`));
    if (!file || file.kind !== "pdf") throw new Error(`no PDF file "${fileId}" on case "${caseId}"`);
    return file;
  };

  return {
    async readPage(caseId: string, fileId: string, page: number) {
      const file = find(caseId, fileId);
      const pdf = await load(file);
      return {
        case_id: caseId,
        file_id: fileId,
        page,
        pages: pdf.pages,
        text: await pdf.text(page),
      };
    },

    async renderPage(caseId: string, fileId: string, page: number, scale?: number) {
      const file = find(caseId, fileId);
      const pdf = await load(file);
      return {
        case_id: caseId,
        file_id: fileId,
        page,
        pages: pdf.pages,
        ...(await pdf.image(page, scale)),
      };
    },

    async renderRegion(
      caseId: string,
      fileId: string,
      page: number,
      region: PdfRenderRegion,
      scale?: number,
    ) {
      const file = find(caseId, fileId);
      const pdf = await load(file);
      return {
        case_id: caseId,
        file_id: fileId,
        page,
        pages: pdf.pages,
        region,
        ...(await pdf.region(page, region, scale)),
      };
    },

    async search(caseId: string, fileId: string, query: string) {
      const file = find(caseId, fileId);
      const pdf = await load(file);
      const q = compact(query);
      const terms = q.toLowerCase().split(" ").filter(Boolean);
      const results = (await pdf.allText())
        .map((p) => {
          const hay = p.text.toLowerCase();
          const hits = terms.filter((term) => hay.includes(term)).length;
          return { ...p, hits };
        })
        .filter((p) => p.hits > 0)
        .sort((a, b) => b.hits - a.hits || a.page - b.page)
        .slice(0, 8)
        .map((p) => ({ page: p.page, snippet: snippet(p.text, terms) }));

      return { case_id: caseId, file_id: fileId, query: q, pages: pdf.pages, results };
    },
  };
}
