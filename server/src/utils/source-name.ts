export function defaultSourceName(url: URL): string {
  const filename = url.pathname.split('/').at(-1);
  if (!filename) return url.hostname;
  try {
    return decodeURIComponent(filename).trim() || url.hostname;
  } catch {
    return filename;
  }
}
