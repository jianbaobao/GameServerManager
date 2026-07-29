// SSRF Protection - check if target host is a private/internal address
export function isPrivateHost(host: string): boolean {
  const patterns = [
    /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./, /^169\.254\./, /^0\./,
    /^::1$/, /^fc00:/, /^fd00:/, /^fe80:/, /^::ffff:/
  ]
  const addr = host.replace(/^\[|\]$/g, '')
  if (addr.includes(':')) return patterns.some(p => p.test(addr))
  const ip4 = addr.split(':')[0]
  return patterns.some(p => p.test(ip4)) || ip4 === 'localhost'
}

export function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}
