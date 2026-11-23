export function mobileProgrammingPreviewRouteAllowed(path: string, method: string) {
  return (
    (method === 'GET' && path === '/api/mobile/programming-preview/status') ||
    (method === 'POST' && /^\/api\/mobile\/programming-preview\/projects\/[A-Za-z0-9_-]{1,100}$/.test(path))
  );
}
