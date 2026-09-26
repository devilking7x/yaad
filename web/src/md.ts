// Tiny SAFE markdown renderer for assistant messages.
// We escape HTML first, then only generate our own tags —
// so model output can never inject scripts or markup.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(md: string): string {
  let out = md;
  out = out.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );
  return out;
}

function renderChunk(chunk: string): string {
  const lines = chunk.split("\n");
  let out = "";
  let inList = false;
  for (const line of lines) {
    const lm = line.match(/^[-*]\s+(.*)/);
    if (lm) {
      if (!inList) {
        out += '<ul class="md-list">';
        inList = true;
      }
      out += `<li>${inline(lm[1])}</li>`;
    } else {
      if (inList) {
        out += "</ul>";
        inList = false;
      }
      if (line.trim()) out += `<p>${inline(line)}</p>`;
    }
  }
  if (inList) out += "</ul>";
  return out;
}

export function renderRich(text: string): string {
  const esc = escapeHtml(text);
  const fence = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let html = "";
  let m: RegExpExecArray | null;
  while ((m = fence.exec(esc)) !== null) {
    html += renderChunk(esc.slice(last, m.index));
    html += `<pre class="md-pre"><code>${m[2].replace(/\n$/, "")}</code></pre>`;
    last = m.index + m[0].length;
  }
  html += renderChunk(esc.slice(last));
  return html;
}
