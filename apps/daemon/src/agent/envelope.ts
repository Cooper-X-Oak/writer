// stdin user-message envelope for `claude --input-format stream-json`.
// Shape confirmed against the real CLI in PoC-0 (see docs/agent-layer.md).

export function userMessageEnvelope(text: string): string {
  return (
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
  );
}
