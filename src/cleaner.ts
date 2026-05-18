const LEADING_SECTION_HEADER =
  /^(?:\d+\s*(?:[.)]\s*)?)?(?:WARNINGS AND PRECAUTIONS|WARNINGS AND CAUTIONS|BOXED WARNING|INDICATIONS AND USAGE|DRUG INTERACTIONS|DOSAGE AND ADMINISTRATION|ADVERSE REACTIONS|CONTRAINDICATIONS|PRECAUTIONS|PREGNANCY|WARNINGS?|WARNING)\b\s*[:.\-]?\s*/i;

const SUBSECTION_HEADER = /^(?:Limitations of Use|Limitation of Use)\s*:\s*/i;

const CROSS_REFERENCE = /\(\s*see\s+[^)]*\)/gi;
const TRAILING_REFERENCE = /\bFor more information,\s*consult the official label\.?$/i;
const BOILERPLATE_PREFIX = /^(?:To report|Please see|Consult|Call your doctor|Unnecessary use|Its use should be reserved)\b/i;
const REFERENCE_NUMBER = /\s*\(\d+\)\s*/g;

export function cleanFdaSection(raw: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of raw) {
    const normalized = value
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) continue;

    const withoutHeader = normalized
      .replace(LEADING_SECTION_HEADER, "")
      .replace(SUBSECTION_HEADER, "")
      .replace(CROSS_REFERENCE, "")
      .replace(TRAILING_REFERENCE, "")
      .replace(REFERENCE_NUMBER, " ")
      .trim();
    const sentences = splitSentences(withoutHeader);

    for (const sentence of sentences) {
      const item = sentence
        .replace(LEADING_SECTION_HEADER, "")
        .replace(SUBSECTION_HEADER, "")
        .replace(/^[*•\-\s]+/, "")
        .replace(/\s+/g, " ")
        .replace(/\s+([.,;:!?])/g, "$1")
        .trim()
        .replace(/[;:]\s*$/, ".");

      if (!item || BOILERPLATE_PREFIX.test(item)) continue;

      const capitalized = capitalizeFirst(rewriteCommonFdaProse(item));
      const key = canonicalKey(capitalized);
      if (seen.has(key)) continue;

      seen.add(key);
      cleaned.push(capitalized);
      if (cleaned.length >= 20) return cleaned;
    }
  }

  return cleaned;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function rewriteCommonFdaProse(text: string): string {
  return text
    .replace(/^[A-Z][A-Za-z0-9 -]+\s+has been shown to be\s+/i, "")
    .replace(/^has been shown to be\s+/i, "")
    .replace(/^(.+?)\s+(is|are)\s+an?\s+[a-z][a-z -]+\s+indicated for\s+/i, "$1 $2 indicated for ");
}

function canonicalKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
