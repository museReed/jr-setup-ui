export function extractLoginHints(text) {
  if (typeof text !== "string") {
    return { url: null, code: null };
  }

  const urlMatch = text.match(/https:\/\/\S+/);
  const codeMatch = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i);

  return {
    url: urlMatch === null ? null : urlMatch[0].replace(/[.,)]+$/, ""),
    code: codeMatch === null ? null : codeMatch[0],
  };
}
