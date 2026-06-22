import { describe, it, expect } from 'vitest';
import {
  buildPreviewSrcDoc,
  isPreviewSelect,
  PREVIEW_MESSAGE_SOURCE,
  PREVIEW_SELECT_TYPE,
} from './bridge';

describe('buildPreviewSrcDoc', () => {
  it('injects the bridge script before </body> with edit enabled', () => {
    const out = buildPreviewSrcDoc('<html><body><p data-block="b0">x</p></body></html>', true);
    expect(out).toContain('var EDIT=true');
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('</body>'));
    expect(out).toContain(PREVIEW_SELECT_TYPE);
  });

  it('disables edit when editMode is false', () => {
    expect(buildPreviewSrcDoc('<body></body>', false)).toContain('var EDIT=false');
  });

  it('appends the script when there is no </body>', () => {
    const out = buildPreviewSrcDoc('<p>x</p>', true);
    expect(out).toContain('<script>');
    expect(out.startsWith('<p>x</p>')).toBe(true);
  });
});

describe('isPreviewSelect (parent-side trust guard)', () => {
  const frame = {} as Window; // sentinel iframe window (reference identity is the check)
  const good = {
    source: PREVIEW_MESSAGE_SOURCE,
    type: PREVIEW_SELECT_TYPE,
    blockId: 'b1',
    text: 'hi',
  };

  it('accepts a well-formed message from the right frame', () => {
    expect(isPreviewSelect({ source: frame, data: good } as unknown as MessageEvent, frame)).toBe(true);
  });

  it('rejects a message from a different window (event.source mismatch)', () => {
    const other = {} as Window;
    expect(isPreviewSelect({ source: other, data: good } as unknown as MessageEvent, frame)).toBe(false);
  });

  it('rejects a message missing the source tag or with the wrong type', () => {
    expect(isPreviewSelect({ source: frame, data: { ...good, source: 'evil' } } as unknown as MessageEvent, frame)).toBe(false);
    expect(isPreviewSelect({ source: frame, data: { ...good, type: 'other' } } as unknown as MessageEvent, frame)).toBe(false);
  });

  it('rejects when blockId/text are not strings or the frame is null', () => {
    expect(isPreviewSelect({ source: frame, data: { ...good, blockId: 1 } } as unknown as MessageEvent, frame)).toBe(false);
    expect(isPreviewSelect({ source: frame, data: good } as unknown as MessageEvent, null)).toBe(false);
  });
});
