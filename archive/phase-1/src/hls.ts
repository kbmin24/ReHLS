export type ResourceKind = 'manifest' | 'segment';

export class UnsupportedHlsError extends Error {
  override name = 'UnsupportedHlsError';
}

export class InvalidHlsError extends Error {
  override name = 'InvalidHlsError';
}

export function rewriteManifest(
  text: string,
  baseUrl: URL,
  register: (url: URL, kind: ResourceKind) => string,
): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '#EXTM3U') {
    throw new InvalidHlsError('Invalid HLS playlist');
  }

  const unsupportedTag = /^#EXT-X-(?:KEY|SESSION-KEY|MEDIA|MAP|PART|PART-INF|PRELOAD-HINT|BYTERANGE|I-FRAME-STREAM-INF)(?=:|$)/;
  for (const line of lines) {
    if (unsupportedTag.test(line) || (line.startsWith('#') && /\bURI\s*=/i.test(line))) {
      throw new UnsupportedHlsError('Unsupported HLS feature');
    }
  }

  const master = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'));
  const media = lines.some((line) => line.startsWith('#EXTINF:') || line.startsWith('#EXT-X-TARGETDURATION:'));
  if (master === media) {
    throw new InvalidHlsError('Invalid HLS playlist');
  }
  const kind: ResourceKind = master ? 'manifest' : 'segment';
  const expectedUriTag = master ? '#EXT-X-STREAM-INF:' : '#EXTINF:';

  const resources = new Map<number, URL>();
  let awaitingUri = false;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line === '') {
      if (awaitingUri) throw new InvalidHlsError('Missing HLS URI');
      continue;
    }
    if (line.startsWith('#')) {
      if (awaitingUri) throw new InvalidHlsError('Missing HLS URI');
      if (line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXTINF:')) {
        if (!line.startsWith(expectedUriTag)) {
          throw new InvalidHlsError('Mixed HLS playlist');
        }
        awaitingUri = true;
      }
      continue;
    }
    if (!awaitingUri) throw new InvalidHlsError('Unexpected HLS URI');
    try {
      resources.set(index, new URL(line, baseUrl));
    } catch {
      throw new InvalidHlsError('Invalid HLS URI');
    }
    awaitingUri = false;
  }
  if (awaitingUri || resources.size === 0) {
    throw new InvalidHlsError('Missing HLS URI');
  }

  return lines.map((line, index) => {
    const url = resources.get(index);
    return url ? register(url, kind) : line;
  }).join(newline);
}
