/**
 * Caption overlay generation (ASS/SSA).
 *
 * ASS is used because it gives per-cue styling, positioning, scaling and
 * animation in a single filter — far more reliable than drawtext for timed text.
 */
import type { CaptionCue } from '@/lib/timing';

export interface CaptionStyleSpec {
  fontName: string;
  /** ASS colour is &HAABBGGRR (alpha inverted). */
  primary: string;
  highlight: string;
  outline: string;
  back: string;
  bold: number;
  fontScale: number;
  outlineWidth: number;
  shadow: number;
  alignment: number; // numpad: 2 = bottom-centre
  marginV: number;
  marginH: number;
  /** Optional animated emphasis on the leading word. */
  karaoke?: boolean;
  uppercase?: boolean;
  scaleX?: number;
  scaleY?: number;
  spacing?: number;
  borderStyle?: number;
}

/** Margins are expressed as a fraction of height so they scale with output. */
const MARGIN_V_RATIO = 0.16;
const MARGIN_H_RATIO = 0.08;

export const CAPTION_STYLE_SPEC: Record<string, CaptionStyleSpec> = {
  clean: {
    fontName: 'Arial',
    primary: '&H00FFFFFF',
    highlight: '&H00FFFFFF',
    outline: '&H00202020',
    back: '&H90000000',
    bold: 0,
    fontScale: 0.052,
    outlineWidth: 2,
    shadow: 0,
    alignment: 2,
    marginV: 0,
    marginH: 0,
    uppercase: false,
  },
  bold: {
    fontName: 'Arial',
    primary: '&H00FFFFFF',
    highlight: '&H0020E0FF',
    outline: '&H00000000',
    back: '&HB0000000',
    bold: -1,
    // Sized so a ~13-character word still fits inside the safe margins on a
    // 1080-wide frame, which avoids ugly mid-word hard breaks.
    fontScale: 0.057,
    outlineWidth: 5,
    shadow: 1,
    alignment: 2,
    marginV: 0,
    marginH: 0,
    uppercase: true,
    scaleY: 100,
  },
  cinematic: {
    fontName: 'Georgia',
    primary: '&H00F0E8D8',
    highlight: '&H00D8C090',
    outline: '&H00000000',
    back: '&H80000000',
    bold: 0,
    fontScale: 0.056,
    outlineWidth: 3,
    shadow: 2,
    alignment: 2,
    marginV: 0,
    marginH: 0,
    spacing: 1,
  },
  highlighted: {
    fontName: 'Arial',
    primary: '&H00202020',
    highlight: '&H000000FF',
    outline: '&H00FFFFFF',
    back: '&H00FFE45C',
    bold: -1,
    fontScale: 0.057,
    outlineWidth: 3,
    shadow: 0,
    alignment: 2,
    marginV: 0,
    marginH: 0,
    uppercase: true,
  },
  documentary: {
    fontName: 'Arial',
    primary: '&H00E8E8E8',
    highlight: '&H00C8C8C8',
    outline: '&H00000000',
    back: '&H90000000',
    bold: 0,
    fontScale: 0.05,
    outlineWidth: 2,
    shadow: 1,
    alignment: 2,
    marginV: 0,
    marginH: 0,
  },
  minimal: {
    fontName: 'Arial',
    primary: '&H00D0D0D8',
    highlight: '&H00D0D0D8',
    outline: '&H00000000',
    back: '&H00000000',
    bold: 0,
    fontScale: 0.042,
    outlineWidth: 1,
    shadow: 0,
    alignment: 2,
    marginV: 0,
    marginH: 0,
  },
};

function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Escape the characters libass treats as markup. */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

/** Split a word that is too long for one line into fixed-width chunks. */
function hardBreak(word: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += maxChars) {
    chunks.push(word.slice(i, i + maxChars));
  }
  return chunks;
}

/**
 * Wrap text into lines that each fit `maxChars`.
 *
 * A single word longer than the wrap width is hard-broken, because caption
 * fonts cannot shrink to fit and would otherwise bleed off both edges.
 * Returns unescaped lines so callers can escape each line independently —
 * escaping after joining would double-escape the ASS line-break token.
 */
export function wrapLines(text: string, maxChars: number, maxLines = 3): string[] {
  const width = Math.max(4, maxChars);
  const words = text.split(/\s+/).filter(Boolean);

  // Pre-split any oversized word so it can never exceed the line width.
  const tokens: string[] = [];
  for (const word of words) {
    if (word.length > width) tokens.push(...hardBreak(word, width));
    else tokens.push(word);
  }

  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    if (current.length === 0) {
      current = token;
    } else if (`${current} ${token}`.length <= width) {
      current = `${current} ${token}`;
    } else {
      lines.push(current);
      current = token;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  // Still overflowing the allowed height: ellipsise the final line.
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.length > width
    ? `${last.slice(0, width - 1).trimEnd()}…`
    : `${last}…`;
  return kept;
}

/** The ASS line-break token. */
const ASS_BREAK = '\\N';

/** Wrap text and join with ASS line breaks. */
export function wrapCaption(text: string, maxChars: number, maxLines = 3): string {
  return wrapLines(text, maxChars, maxLines).join(ASS_BREAK);
}

export function buildAssDocument(
  cues: CaptionCue[],
  spec: CaptionStyleSpec,
  width: number,
  height: number,
): string {
  const playResX = width;
  const playResY = height;
  const fontSize = Math.max(18, Math.round(height * spec.fontScale));
  const marginV = Math.round(height * MARGIN_V_RATIO) + spec.marginV;
  const marginH = Math.round(width * MARGIN_H_RATIO) + spec.marginH;
  // Conservative glyph-width estimate so text never touches the safe margins.
  const glyphRatio = 0.62;
  const usableWidth = width - marginH * 2;
  const maxChars = Math.max(6, Math.floor(usableWidth / (fontSize * glyphRatio)));
  // Cap height so 3 lines never run off the top of the safe area.
  const maxLines = Math.max(1, Math.min(3, Math.floor((height * 0.3) / fontSize)));

  const header = [
    '[Script Info]',
    '; Generated by ShortForge AI',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Default',
      spec.fontName,
      String(fontSize),
      spec.primary,
      spec.highlight,
      spec.outline,
      spec.back,
      spec.bold ? '-1' : '0',
      '0',
      '0',
      '0',
      String(spec.scaleX ?? 100),
      String(spec.scaleY ?? 100),
      String(spec.spacing ?? 0),
      '0',
      String(spec.borderStyle ?? 1),
      String(spec.outlineWidth),
      String(spec.shadow),
      String(spec.alignment),
      String(marginH),
      String(marginH),
      String(marginV),
      '1',
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events = cues
    .map((cue) => {
      const raw = spec.uppercase ? cue.text.toUpperCase() : cue.text;
      const lines = wrapLines(raw, maxChars, maxLines);

      // Auto-fit: if the widest line still exceeds the safe area, shrink this
      // cue's font via an override tag rather than letting it bleed off-frame.
      const widest = lines.reduce((m, l) => Math.max(m, l.length), 1);
      let override = '';
      const rendered = widest * fontSize * glyphRatio;
      if (rendered > usableWidth) {
        const fitted = Math.max(14, Math.floor((usableWidth / (widest * glyphRatio)) * 0.96));
        override = `{\\fs${fitted}}`;
      }

      // Escape each line independently, THEN join with the ASS break token.
      const text = lines.map((l) => escapeAssText(l)).join(ASS_BREAK);
      // A short fade-in/out per cue reads as a natural caption animation.
      const effect = '{\\fad(90,90)}';
      return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${override}${effect}${text}`;
    })
    .join('\n');

  return `${header}\n${events}\n`;
}

export { assTime };
