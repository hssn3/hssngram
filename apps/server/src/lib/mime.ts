const byExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  zip: 'application/zip',
};

export function mimeFromKey(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  return byExtension[extension] ?? 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return /^image\/(jpeg|png|webp|gif|avif)$/.test(mime);
}
