import { parseXmltv as parseLibraryXmltv } from '@iptv/xmltv';

import type { GuideSnapshot, XmltvLimits, XmltvWindow } from './xmltv.types.js';

export class XmltvParseError extends Error {
  constructor(public readonly code: 'PARSE_FAILED' | 'EMPTY_GUIDE' | 'TOO_LARGE') { super(code); }
}

export const XMLTV_LIMITS: XmltvLimits = {
  maxCompressedBytes: 16 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxChannels: 20_000,
  maxPrograms: 200_000,
  maxTextLength: 4_096,
  maxDepth: 32,
};

function validText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw new XmltvParseError('PARSE_FAILED');
  if (value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9A-Fa-f]+|#[0-9]+);/g, '').includes('&')) {
    throw new XmltvParseError('PARSE_FAILED');
  }
  const text = value.replace(/&([^;]+);/g, (_match, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity in named) return named[entity]!;
    const point = /^#x[0-9a-f]+$/i.test(entity) ? Number.parseInt(entity.slice(2), 16) :
      /^#[0-9]+$/.test(entity) ? Number.parseInt(entity.slice(1), 10) : NaN;
    if (!Number.isInteger(point) || point < 1 || point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)) throw new XmltvParseError('PARSE_FAILED');
    return String.fromCodePoint(point);
  }).trim();
  if (!text || text.length > maxLength) throw new XmltvParseError('PARSE_FAILED');
  return text;
}

/** Rejects declarations and excessive nesting before the whole-document XMLTV parser runs. */
function preflight(xml: string, limits: XmltvLimits): void {
  if (Buffer.byteLength(xml, 'utf8') > limits.maxExpandedBytes) throw new XmltvParseError('TOO_LARGE');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new XmltvParseError('PARSE_FAILED');
  let depth = 0;
  let cursor = 0;
  for (const match of xml.matchAll(/<\/?([A-Za-z][\w:.-]*)\b[^>]*>/g)) {
    const token = match[0];
    if (match.index! > cursor && xml.slice(cursor, match.index).length > limits.maxTextLength * 16) {
      throw new XmltvParseError('TOO_LARGE');
    }
    cursor = match.index! + token.length;
    if (token.startsWith('</')) depth--;
    else if (!token.endsWith('/>')) depth++;
    if (depth < 0 || depth > limits.maxDepth) throw new XmltvParseError('PARSE_FAILED');
  }
  if (depth !== 0 || !/<tv(?:\s|>)/.test(xml) || !/<\/tv\s*>/.test(xml)) throw new XmltvParseError('PARSE_FAILED');
}

/** Normalizes a bounded XMLTV document; callers bound download, decompression, and time. */
export function parseGuideDocument(xml: string, limits: XmltvLimits, window: XmltvWindow): GuideSnapshot {
  preflight(xml, limits);
  let parsed: ReturnType<typeof parseLibraryXmltv>;
  try { parsed = parseLibraryXmltv(xml); }
  catch { throw new XmltvParseError('PARSE_FAILED'); }
  if ((parsed.channels?.length ?? 0) > limits.maxChannels ||
      (parsed.programmes?.length ?? 0) > limits.maxPrograms) throw new XmltvParseError('TOO_LARGE');
  const channels: GuideSnapshot['channels'] = [];
  const ids = new Set<string>();
  for (const channel of parsed.channels ?? []) {
    const xmltvId = validText(channel.id, limits.maxTextLength);
    if (ids.has(xmltvId)) throw new XmltvParseError('PARSE_FAILED');
    ids.add(xmltvId);
    channels.push({ xmltvId, displayName: validText(channel.displayName?.[0]?._value, limits.maxTextLength) });
  }
  const programs: GuideSnapshot['programs'] = [];
  const programKeys = new Set<string>();
  for (const program of parsed.programmes ?? []) {
    const xmltvId = validText(program.channel, limits.maxTextLength);
    if (!ids.has(xmltvId)) throw new XmltvParseError('PARSE_FAILED');
    const startsAt = program.start;
    const endsAt = program.stop;
    if (!(startsAt instanceof Date) || !(endsAt instanceof Date) ||
        !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
        endsAt <= startsAt) throw new XmltvParseError('PARSE_FAILED');
    const title = validText(program.title?.[0]?._value, limits.maxTextLength);
    if (endsAt > window.startsAt && startsAt < window.endsAt) {
      const key = JSON.stringify([xmltvId, startsAt.getTime(), endsAt.getTime(), title]);
      if (!programKeys.has(key)) {
        programKeys.add(key);
        programs.push({ xmltvId, title, startsAt, endsAt });
      }
    }
  }
  if (channels.length === 0 || programs.length === 0) throw new XmltvParseError('EMPTY_GUIDE');
  return { channels, programs };
}
