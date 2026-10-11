export type ResourceKind = 'manifest' | 'segment' | 'map' | 'key';
export type ByteRange = { offset: number; length: number };
export type RegisterResource = (url: URL, kind: ResourceKind, range?: ByteRange) => string;

export class InvalidHlsError extends Error {
  readonly code = 'INVALID_HLS';
  constructor() { super('INVALID_HLS'); }
}

export class UnsupportedHlsError extends Error {
  readonly code = 'UNSUPPORTED_HLS';
  constructor() { super('UNSUPPORTED_HLS'); }
}

type Attribute = { value: string; start: number; end: number; quoted: boolean };
type Reference = { line: number; start: number; end: number; url: URL; kind: ResourceKind; range?: ByteRange };

const supportedTags = new Set([
  'EXT-X-VERSION', 'EXT-X-INDEPENDENT-SEGMENTS', 'EXT-X-START',
  'EXT-X-MEDIA', 'EXT-X-STREAM-INF', 'EXT-X-I-FRAME-STREAM-INF',
  'EXTINF', 'EXT-X-TARGETDURATION', 'EXT-X-MEDIA-SEQUENCE',
  'EXT-X-DISCONTINUITY-SEQUENCE', 'EXT-X-ENDLIST', 'EXT-X-PLAYLIST-TYPE',
  'EXT-X-I-FRAMES-ONLY', 'EXT-X-DISCONTINUITY', 'EXT-X-KEY', 'EXT-X-MAP',
  'EXT-X-PROGRAM-DATE-TIME', 'EXT-X-BYTERANGE',
]);
const uriTags = new Set(['EXT-X-MEDIA', 'EXT-X-I-FRAME-STREAM-INF', 'EXT-X-KEY', 'EXT-X-MAP']);
const masterTags = new Set(['EXT-X-MEDIA', 'EXT-X-STREAM-INF', 'EXT-X-I-FRAME-STREAM-INF']);
const mediaTags = new Set([
  'EXTINF', 'EXT-X-TARGETDURATION', 'EXT-X-MEDIA-SEQUENCE',
  'EXT-X-DISCONTINUITY-SEQUENCE', 'EXT-X-ENDLIST', 'EXT-X-PLAYLIST-TYPE',
  'EXT-X-I-FRAMES-ONLY', 'EXT-X-DISCONTINUITY', 'EXT-X-KEY', 'EXT-X-MAP',
  'EXT-X-PROGRAM-DATE-TIME', 'EXT-X-BYTERANGE',
]);

/**
 * Parses the attributes from a line in the HLS manifest.
 * @param line The line to parse.
 * @returns A map of attribute names to their values.
 */
function attributes(line: string): Map<string, Attribute> {
  const colon = line.indexOf(':');
  if (colon < 0) throw new InvalidHlsError();
  const result = new Map<string, Attribute>();
  let start = colon + 1;
  let quoted = false;
  for (let index = start; index <= line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (index !== line.length && (line[index] !== ',' || quoted)) continue;
    if (quoted) throw new InvalidHlsError();

    const field = line.slice(start, index);
    const match = /^([A-Z0-9-]+)=("[^"]*"|[^",]+)$/.exec(field);
    if (!match || result.has(match[1]!)) throw new InvalidHlsError();

    const name = match[1]!;
    const raw = match[2]!;
    const isQuoted = raw.startsWith('"');
    const valueStart = start + name.length + 1 + (isQuoted ? 1 : 0);

    result.set(name, {
      value: isQuoted ? raw.slice(1, -1) : raw,
      start: valueStart,
      end: valueStart + raw.length - (isQuoted ? 2 : 0),
      quoted: isQuoted,
    });
    start = index + 1;
  }
  return result;
}

function resourceUrl(value: string, base: URL): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new InvalidHlsError();
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new UnsupportedHlsError();
  return url;
}

function checkedRange(range?: ByteRange): ByteRange | undefined {
  if (!range) return undefined;
  const { offset, length } = range;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 ||
      !Number.isSafeInteger(offset + length)) throw new InvalidHlsError();
  return { offset, length };
}

function byteRange(value: string, previous?: ByteRange): ByteRange {
  const match = /^(\d+)(?:@(\d+))?$/.exec(value);
  if (!match) throw new InvalidHlsError();
  const length = Number(match[1]);
  const offset = match[2] === undefined ? previous && previous.offset + previous.length : Number(match[2]);
  if (offset === undefined) throw new InvalidHlsError();
  return checkedRange({ offset, length })!;
}

function positiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidHlsError();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new InvalidHlsError();
  return number;
}

function checkSupportedTags(lines: string[], base: URL): void {
  if (lines[0] !== '#EXTM3U') throw new InvalidHlsError();
  for (const line of lines.slice(1)) {
    if (!line || !line.startsWith('#')) {
      if (line) resourceUrl(line, base);
      continue;
    }
    const tag = /^#(EXT(?:-X-[A-Z0-9-]+|INF))(?::|$)/.exec(line)?.[1];
    if (line.startsWith('#EXT') && (!tag || !supportedTags.has(tag))) throw new UnsupportedHlsError();
    const withoutUri = tag && uriTags.has(tag)
      ? line.replace(/(?:^|[:,])URI="[^"]*"/g, '')
      : line;
    if (tag && uriTags.has(tag) && (line.match(/(?:^|[:,])URI=/g)?.length ?? 0) > 1) {
      throw new InvalidHlsError();
    }
    if (/(?:^|[:,])[A-Z0-9-]*URI\s*=|https?:\/\//i.test(withoutUri)) throw new UnsupportedHlsError();
    if (tag === 'EXT-X-KEY' && /(?:^|,)METHOD=SAMPLE-AES(?:,|$)/.test(line)) {
      throw new UnsupportedHlsError();
    }
  }
}

function uriReference(fields: Map<string, Attribute>, line: number, base: URL, kind: ResourceKind,
  required: boolean, range?: ByteRange): Reference | undefined {
  const uri = fields.get('URI');
  if (!uri) {
    if (required) throw new InvalidHlsError();
    return undefined;
  }
  if (!uri.quoted || !uri.value) throw new InvalidHlsError();
  return { line, start: uri.start, end: uri.end, url: resourceUrl(uri.value, base), kind,
    ...(range ? { range } : {}) };
}

/**
 * Rewrites an HLS manifest, replacing all resource URLs with registered paths.
 * @param text The original HLS manifest.
 * @param finalUrl The URL of the final manifest.
 * @param register A function to register a resource.
 * @returns The rewritten HLS manifest.
 */
export function rewriteManifest(text: string, finalUrl: URL, register: RegisterResource): string {
  if (text.length > 1024 * 1024) throw new InvalidHlsError();
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  checkSupportedTags(lines, finalUrl);

  const tags = lines.slice(1).filter((line) => line.startsWith('#')).map((line) => line.slice(1).split(':', 1)[0]!);
  const isMaster = tags.some((tag) => masterTags.has(tag));
  if (isMaster && tags.some((tag) => mediaTags.has(tag))) throw new InvalidHlsError();
  const rewritten = [...lines];
  const references: Reference[] = [];
  let resourceCount = 0;
  let normalVariantCount = 0;
  let pendingVariant = false;
  let pendingSegment = false;
  let pendingRangeLine: number | undefined;
  let previousSegment: string | undefined;
  let previousRange: ByteRange | undefined;
  let targetDuration: number | undefined;
  let version: number | undefined;
  let requiredVersion = 1;
  let keyMethod: string | undefined;
  let keyIv = false;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    if (!line.startsWith('#')) {
      if (isMaster ? !pendingVariant : !pendingSegment || !targetDuration) throw new InvalidHlsError();
      let range: ByteRange | undefined;
      if (pendingRangeLine !== undefined) {
        const raw = lines[pendingRangeLine]!.slice('#EXT-X-BYTERANGE:'.length);
        range = byteRange(raw, previousSegment === line ? previousRange : undefined);
      }
      if (pendingRangeLine !== undefined && range && !lines[pendingRangeLine]!.includes('@')) {
        rewritten[pendingRangeLine] = `#EXT-X-BYTERANGE:${range.length}@${range.offset}`;
      }
      references.push({ line: index, start: 0, end: line.length, url: resourceUrl(line, finalUrl),
        kind: isMaster ? 'manifest' : 'segment',
        ...(range ? { range } : {}) });
      if (isMaster) normalVariantCount++;
      previousSegment = line;
      previousRange = range;
      pendingVariant = false;
      pendingSegment = false;
      pendingRangeLine = undefined;
      resourceCount++;
      continue;
    }
    const tag = line.slice(1).split(':', 1)[0]!;
    if (pendingVariant && line.startsWith('#EXT')) throw new InvalidHlsError();
    if (tag === 'EXT-X-VERSION') version = positiveInteger(line.slice('#EXT-X-VERSION:'.length));
    if (tag === 'EXT-X-TARGETDURATION') targetDuration = positiveInteger(line.slice('#EXT-X-TARGETDURATION:'.length));
    if (tag === 'EXTINF') {
      const duration = /^#EXTINF:(\d+(?:\.\d+)?),/.exec(line)?.[1];
      if (pendingSegment || !duration || !Number.isFinite(Number(duration)) || Number(duration) <= 0 ||
          (targetDuration && Math.round(Number(duration)) > targetDuration)) throw new InvalidHlsError();
      if (!Number.isInteger(Number(duration))) requiredVersion = Math.max(requiredVersion, 3);
      pendingSegment = true;
    }
    if (tag === 'EXT-X-STREAM-INF') {
      positiveInteger(attributes(line).get('BANDWIDTH')?.value ?? '');
      pendingVariant = true;
    }
    if (!uriTags.has(tag) && tag !== 'EXT-X-BYTERANGE') continue;
    if (tag === 'EXT-X-BYTERANGE') {
      requiredVersion = Math.max(requiredVersion, 4);
      if (!pendingSegment || pendingRangeLine !== undefined) throw new InvalidHlsError();
      if (!/^(\d+)(?:@(\d+))?$/.test(line.slice('#EXT-X-BYTERANGE:'.length))) throw new InvalidHlsError();
      pendingRangeLine = index;
      continue;
    }
    const fields = attributes(line);
    if (tag === 'EXT-X-MEDIA' && (!fields.has('TYPE') || !fields.has('GROUP-ID') || !fields.has('NAME'))) {
      throw new InvalidHlsError();
    }
    if (tag === 'EXT-X-I-FRAME-STREAM-INF') {
      positiveInteger(fields.get('BANDWIDTH')?.value ?? '');
      requiredVersion = Math.max(requiredVersion, 4);
    }
    if (tag === 'EXT-X-KEY') {
      keyMethod = fields.get('METHOD')?.value;
      keyIv = fields.has('IV');
      if (keyMethod === 'NONE') {
        if (fields.size !== 1) throw new InvalidHlsError();
        continue;
      }
      if (keyMethod !== 'AES-128' || (fields.get('KEYFORMAT')?.value ?? 'identity') !== 'identity' ||
          (fields.get('KEYFORMATVERSIONS')?.value && fields.get('KEYFORMATVERSIONS')?.value !== '1')) {
        throw new UnsupportedHlsError();
      }
      if (keyIv && !/^0[xX][0-9a-fA-F]{32}$/.test(fields.get('IV')!.value)) throw new InvalidHlsError();
      if (fields.has('KEYFORMAT') || fields.has('KEYFORMATVERSIONS')) requiredVersion = Math.max(requiredVersion, 5);
    }
    let range: ByteRange | undefined;
    if (tag === 'EXT-X-MAP') {
      requiredVersion = Math.max(requiredVersion, tags.includes('EXT-X-I-FRAMES-ONLY') ? 5 : 6);
      if (keyMethod === 'AES-128' && !keyIv) throw new UnsupportedHlsError();
      if (fields.has('BYTERANGE') && !fields.get('BYTERANGE')!.quoted) throw new InvalidHlsError();
      range = fields.has('BYTERANGE') ? byteRange(fields.get('BYTERANGE')!.value) : undefined;
    }
    const kind = tag === 'EXT-X-KEY' ? 'key' : tag === 'EXT-X-MAP' ? 'map' : 'manifest';
    const required = tag !== 'EXT-X-MEDIA';
    const ref = uriReference(fields, index, finalUrl, kind, required, range);
    if (ref) references.push(ref);
  }
  if (pendingVariant || pendingSegment || pendingRangeLine !== undefined || resourceCount === 0 ||
      (isMaster && normalVariantCount === 0) || (!isMaster && !targetDuration) ||
      (version ?? 1) < requiredVersion) throw new InvalidHlsError();

  for (const ref of references) {
    const path = register(ref.url, ref.kind, ref.range);
    if (!path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path)) throw new InvalidHlsError();
    rewritten[ref.line] = rewritten[ref.line]!.slice(0, ref.start) + path + rewritten[ref.line]!.slice(ref.end);
  }
  return rewritten.join(newline);
}
