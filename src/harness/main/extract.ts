export interface ExtractHtmlResult {
  html: string;
  /** True when the output was wrapped in a fenced code block. */
  fenced: boolean;
}

const FENCE_RE = /```(?:html|xml)?\s*\n([\s\S]*?)\n```/i;

/**
 * Extract a complete HTML document from a model response. The model may wrap
 * the document in markdown fences or preface it with prose; this normalizes
 * the output to just the document. Falls back to the raw output so the
 * admission validator is the final authority.
 */
export function extractHtmlFromOutput(output: string): ExtractHtmlResult {
  const match = FENCE_RE.exec(output);
  if (match && match[1].trim().length > 0) {
    return { html: match[1].trim(), fenced: true };
  }
  return { html: output.trim(), fenced: false };
}

/** Bounded preview of the first violation lines for repair prompts. */
export function describeViolations(violations: ReadonlyArray<{ message: string }>, max = 12): string {
  return violations.slice(0, max).map((violation) => `- ${violation.message}`).join("\n");
}
