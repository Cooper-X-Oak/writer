// Preview iframe bridge (ported from open-design's srcdoc edit bridge, trimmed to block-select).
// The script is injected into the sandboxed iframe (sandbox="allow-scripts", NO allow-same-origin —
// the trust boundary). In edit mode it outlines [data-block] paragraphs on hover and, on click,
// posts the picked block to the parent. The parent validates by event.source AND the `source` tag.

export const PREVIEW_MESSAGE_SOURCE = 'hsw-preview';
export const PREVIEW_SELECT_TYPE = 'hsw:select';

export interface PreviewSelectMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE;
  type: typeof PREVIEW_SELECT_TYPE;
  blockId: string;
  text: string;
}

function bridgeScript(editMode: boolean): string {
  // Vanilla JS string, runs inside the iframe. No user data is interpolated — only the edit flag.
  return `<script>(function(){
  var EDIT=${editMode ? 'true' : 'false'};
  if(!EDIT) return;
  var s=document.createElement('style');
  s.textContent='[data-block]{cursor:pointer;transition:background .12s,outline-color .12s;}'+
    '[data-block]:hover{background:rgba(46,204,113,.12);outline:2px solid #2ecc71;outline-offset:3px;border-radius:4px;}';
  document.head.appendChild(s);
  document.addEventListener('click',function(ev){
    var el=ev.target;
    while(el&&el!==document.body&&!(el.getAttribute&&el.getAttribute('data-block'))) el=el.parentElement;
    if(!el||!el.getAttribute) return;
    var id=el.getAttribute('data-block');
    if(!id) return;
    ev.preventDefault(); ev.stopPropagation();
    parent.postMessage({source:'${PREVIEW_MESSAGE_SOURCE}',type:'${PREVIEW_SELECT_TYPE}',blockId:id,text:(el.innerText||el.textContent||'')},'*');
  },true);
})();</script>`;
}

/** Inject the bridge into the article HTML for use as an iframe srcDoc. */
export function buildPreviewSrcDoc(html: string, editMode: boolean): string {
  const script = bridgeScript(editMode);
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script;
}

/** Parent-side guard: a message is a trusted preview select only if it came from our iframe window
 *  AND carries our source tag. (open-design relies on sandbox alone; we add the source check.) */
export function isPreviewSelect(ev: MessageEvent, frame: Window | null | undefined): ev is MessageEvent<PreviewSelectMessage> {
  if (!frame || ev.source !== frame) return false;
  const d = ev.data as Partial<PreviewSelectMessage> | null;
  return (
    !!d &&
    d.source === PREVIEW_MESSAGE_SOURCE &&
    d.type === PREVIEW_SELECT_TYPE &&
    typeof d.blockId === 'string' &&
    typeof d.text === 'string'
  );
}
