// /login?return= の戻り先を同一オリジンのパスに限る。
// 文字列の先頭チェックだけだと、URL パーサがタブや改行を取り除いて //evil.example になる抜け道がある
const base = 'https://return-path.invalid';

export function safeReturnPath(value: string | undefined): string {
  if (!value || !value.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return '/';
  }
  if (url.origin !== base) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
