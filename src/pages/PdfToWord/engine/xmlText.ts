/** XML 1.0 Char production. PDF text can contain control codes and broken
 * surrogate pairs, which older docx versions serialize verbatim. Keep tabs,
 * line breaks, Cyrillic and supplementary Unicode (including emoji).
 */
export function xmlText(value: string): string {
  return Array.from(value).filter(char => {
    const code = char.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
  }).join('');
}
