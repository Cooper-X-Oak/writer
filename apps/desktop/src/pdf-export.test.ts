import { describe, it, expect, vi } from 'vitest';
import { exportArticlePdf, pdfFilename, type PdfExportDeps } from './pdf-export.js';

function deps(over: Partial<PdfExportDeps> = {}): PdfExportDeps {
  return {
    fetchHtml: over.fetchHtml ?? (() => Promise.resolve('<html><body>x</body></html>')),
    htmlToPdf: over.htmlToPdf ?? (() => Promise.resolve(Buffer.from('%PDF-1.7'))),
    pickSavePath: over.pickSavePath ?? (() => Promise.resolve('C:/out/article.pdf')),
    writeFile: over.writeFile,
  };
}

describe('pdfFilename', () => {
  it('strips illegal path chars and appends .pdf', () => {
    expect(pdfFilename('a/b:c?')).toBe('a_b_c_.pdf');
  });
  it('falls back to "article" for an empty/blank title', () => {
    expect(pdfFilename('   ')).toBe('article.pdf');
  });
});

describe('exportArticlePdf', () => {
  it('renders and writes the PDF, returning the saved path', async () => {
    const written: { path: string; len: number }[] = [];
    const res = await exportArticlePdf(
      deps({ writeFile: (p, b) => { written.push({ path: p, len: b.length }); return Promise.resolve(); } }),
      { projectId: 'p1', title: '我的文章' },
    );
    expect(res).toEqual({ saved: true, path: 'C:/out/article.pdf' });
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe('C:/out/article.pdf');
  });

  it('returns {saved:false} and renders nothing when the save dialog is cancelled', async () => {
    const fetchHtml = vi.fn(() => Promise.resolve('<html></html>'));
    const htmlToPdf = vi.fn(() => Promise.resolve(Buffer.from('')));
    const res = await exportArticlePdf(
      deps({ pickSavePath: () => Promise.resolve(undefined), fetchHtml, htmlToPdf }),
      { projectId: 'p1', title: 't' },
    );
    expect(res).toEqual({ saved: false });
    expect(fetchHtml).not.toHaveBeenCalled();
    expect(htmlToPdf).not.toHaveBeenCalled();
  });

  it('throws when projectId is missing', async () => {
    await expect(exportArticlePdf(deps(), { projectId: '  ', title: 't' })).rejects.toThrow(/projectId is required/);
  });
});
