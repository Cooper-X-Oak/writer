// PoC-0 — stdin user-message envelope for `claude --input-format stream-json`.
//
// QUESTION THIS PoC ANSWERS (#1): what exact JSON envelope does the CLI accept on stdin
// for streaming-input mode? This is our best-guess shape (mirrors the Anthropic Messages
// user-message structure). The real run in run.mjs confirms or corrects it.

export function userMessage(text) {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  }) + '\n';
}
