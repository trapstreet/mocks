import type { CaseInputFile } from "./fetch-task";

interface PdfTextPage {
  page: number;
  text: string;
}

interface LoadedPdf {
  pages: number;
  text(page: number): Promise<string>;
  allText(): Promise<PdfTextPage[]>;
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
};

const compact = (s: string) => s.replace(/\s+/g, " ").trim();

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

      const text = async (page: number) => {
        if (!Number.isInteger(page) || page < 1 || page > doc.numPages) {
          throw new Error(`page must be between 1 and ${doc.numPages}`);
        }
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

      return {
        pages: doc.numPages,
        text,
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
