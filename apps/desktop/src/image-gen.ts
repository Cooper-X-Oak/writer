// OpenAI-compatible image generation client. Targets POST {baseURL}/v1/images/generations with a
// Bearer key — the de-facto shape most relay endpoints ("中转站") mirror. Handles both response
// shapes (hosted url or inline b64_json). fetch is injectable so this is unit-tested offline.

export interface ImageGenConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
}

type FetchLike = typeof fetch;

export interface GenerateOpts {
  fetchImpl?: FetchLike;
  size?: string;
}

export async function generateImage(cfg: ImageGenConfig, prompt: string, opts: GenerateOpts = {}): Promise<GeneratedImage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${cfg.baseURL.replace(/\/+$/, '')}/v1/images/generations`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, prompt, size: opts.size ?? '1024x1024' }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`image API ${String(res.status)}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const first = json.data?.[0];
  if (!first) throw new Error('image API returned no image data');

  if (first.b64_json) {
    return { bytes: Buffer.from(first.b64_json, 'base64'), contentType: 'image/png' };
  }
  if (first.url) {
    const imgRes = await fetchImpl(first.url);
    if (!imgRes.ok) throw new Error(`fetching generated image failed: ${String(imgRes.status)}`);
    const contentType = (imgRes.headers.get('content-type') ?? 'image/png').split(';')[0]?.trim() ?? 'image/png';
    return { bytes: Buffer.from(await imgRes.arrayBuffer()), contentType };
  }
  throw new Error('image API response had neither url nor b64_json');
}
