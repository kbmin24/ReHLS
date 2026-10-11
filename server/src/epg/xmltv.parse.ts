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

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeEntity(entity: string): string {
  if (entity in NAMED_ENTITIES) return NAMED_ENTITIES[entity]!;

  let point = NaN;
  if (/^#x[0-9a-f]+$/i.test(entity)) point = Number.parseInt(entity.slice(2), 16);
  else if (/^#[0-9]+$/.test(entity)) point = Number.parseInt(entity.slice(1), 10);

  if (!Number.isInteger(point) || point < 1 || point > 0x10ffff ||
    (point >= 0xd800 && point <= 0xdfff)) throw new XmltvParseError('PARSE_FAILED');
  return String.fromCodePoint(point);
}

/** Validates and normalizes text content, ensuring it's within the specified length. */
function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw new XmltvParseError('PARSE_FAILED');
  if (value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9A-Fa-f]+|#[0-9]+);/g, '').includes('&')) {
    throw new XmltvParseError('PARSE_FAILED');
  }
  const text = value.replace(/&([^;]+);/g, (_match, entity: string) => decodeEntity(entity)).trim();
  if (!text || text.length > maxLength) throw new XmltvParseError('PARSE_FAILED');
  return text;
}

/** Rejects too big xmltv / invalid / malformed documents.
 * @returns void if the document is valid
 * @throws XmltvParseError if the document is invalid
 */
function preflight(xml: string, limits: XmltvLimits): void {
  // Test size
  if (Buffer.byteLength(xml, 'utf8') > limits.maxExpandedBytes)
    throw new XmltvParseError('TOO_LARGE');
  // Test if we get unexpected file type
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    throw new XmltvParseError('PARSE_FAILED');

  // test if nesting is (a) too deep, or (b) unbalanced
  let depth = 0;
  let cursor = 0;
  for (const match of xml.matchAll(/<\/?([A-Za-z][\w:.-]*)\b[^>]*>/g)) {
    const token = match[0];
    const tagStart = match.index!;
    if (tagStart - cursor > limits.maxTextLength * 16) {
      throw new XmltvParseError('TOO_LARGE');
    }
    cursor = tagStart + token.length;
    if (token.startsWith('</')) depth--;
    else if (!token.endsWith('/>')) depth++;
    if (depth < 0 || depth > limits.maxDepth) throw new XmltvParseError('PARSE_FAILED');
  }
  if (depth !== 0 || !/<tv(?:\s|>)/.test(xml) || !/<\/tv\s*>/.test(xml))
    throw new XmltvParseError('PARSE_FAILED');
}

function extractChannels(parsed: ReturnType<typeof parseLibraryXmltv>, limits: XmltvLimits): [GuideSnapshot['channels'], Set<string>] {
  const channels: GuideSnapshot['channels'] = [];
  const channelIds = new Set<string>();

  // CHANNELS
  for (const channel of parsed.channels ?? []) {
    const xmltvId = normalizeText(channel.id, limits.maxTextLength);

    // determine duplicate and add
    if (channelIds.has(xmltvId)) {
      throw new XmltvParseError('PARSE_FAILED');
    }
    channelIds.add(xmltvId);

    const originalDisplayName = channel.displayName?.[0]?._value;
    channels.push({
      xmltvId,
      displayName: normalizeText(originalDisplayName, limits.maxTextLength)
    });
  }
  return [channels, channelIds];
}

function extractPrograms(parsed: ReturnType<typeof parseLibraryXmltv>,
  limits: XmltvLimits,
  channelIds: Set<string>,
  window: XmltvWindow): GuideSnapshot['programs'] {
  const programs: GuideSnapshot['programs'] = [];
  const programKeys = new Set<string>();

  for (const program of parsed.programmes ?? []) {
    const xmltvId = normalizeText(program.channel, limits.maxTextLength);
    if (!channelIds.has(xmltvId))
      throw new XmltvParseError('PARSE_FAILED');

    const startsAt = program.start;
    const endsAt = program.stop;

    // determine if the range is illegal
    if (!(startsAt instanceof Date) || !(endsAt instanceof Date) ||
      !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
      endsAt <= startsAt) {
        throw new XmltvParseError('PARSE_FAILED');
    }

    if (!(endsAt > window.startsAt && startsAt < window.endsAt))
      continue; // out of range

    const title = normalizeText(program.title?.[0]?._value, limits.maxTextLength);

    const key = JSON.stringify([xmltvId, startsAt.getTime(), endsAt.getTime(), title]);

    if (programKeys.has(key)) continue;
    programKeys.add(key);
    programs.push({ xmltvId, title, startsAt, endsAt });
  }

  return programs
}

/** Normalizes a bounded XMLTV document; callers bound download, decompression, and time. */
export function parseGuideDocument(xml: string, limits: XmltvLimits, window: XmltvWindow): GuideSnapshot {
  preflight(xml, limits);
  let parsed: ReturnType<typeof parseLibraryXmltv>;
  try {
    parsed = parseLibraryXmltv(xml);
  } catch {
    throw new XmltvParseError('PARSE_FAILED');
  }

  // determine if the parsed document is too large
  if ((parsed.channels?.length ?? 0) > limits.maxChannels ||
    (parsed.programmes?.length ?? 0) > limits.maxPrograms)
    throw new XmltvParseError('TOO_LARGE');

  const [channels, channelIds] = extractChannels(parsed, limits);
  const programs = extractPrograms(parsed, limits, channelIds, window);

  if (channels.length === 0 || programs.length === 0) throw new XmltvParseError('EMPTY_GUIDE');
  return { channels, programs };
}
