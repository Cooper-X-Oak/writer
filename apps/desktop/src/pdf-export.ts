// PDF export orchestration. The Electron-specific pieces (offscreen window → printToPDF, save
// dialog) are injected as deps so the control flow is unit-tested offline; main.ts supplies the
// real implementations. Order: ask where to save FIRST, so a cancel renders nothing.

import { writeFile as fsWriteFile } from 'node:fs/promises';

export interface PdfExportDeps {
  /** Fetch the self-contained export HTML (images inlined) for a project. */
  fetchHtml: (projectId: string) => Promise<string>;
  /** Render HTML to a PDF buffer (real impl: an offscreen BrowserWindow + printToPDF). */
  htmlToPdf: (html: string) => Promise<Buffer>;
  /** Ask the user where to save; returns the chosen path or undefined if cancelled. */
  pickSavePath: (defaultName: string) => Promise<string | undefined>;
  /** Write the PDF bytes to disk (defaults to fs.writeFile). */
  writeFile?: (path: string, bytes: Buffer) => Promise<void>;
}

export interface PdfExportRequest {
  projectId: string;
  title: string;
}

/** Title → a safe ".pdf" filename (strip path/illegal chars; fall back to "article"). */
export function pdfFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${cleaned || 'article'}.pdf`;
}

export async function exportArticlePdf(
  deps: PdfExportDeps,
  req: PdfExportRequest,
): Promise<{ saved: boolean; path?: string }> {
  const projectId = req.projectId.trim();
  if (!projectId) throw new Error('projectId is required');

  const path = await deps.pickSavePath(pdfFilename(req.title));
  if (!path) return { saved: false };

  const html = await deps.fetchHtml(projectId);
  const pdf = await deps.htmlToPdf(html);
  await (deps.writeFile ?? fsWriteFile)(path, pdf);
  return { saved: true, path };
}
