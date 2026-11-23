export function mobileTeachingToolsRouteAllowed(path: string, method: string) {
  if (method === 'GET' && path === '/api/mobile/teaching-announcements') return true;
  if (
    method === 'GET' &&
    [
      '/api/mobile/analytics',
      '/api/mobile/analytics/filters',
      '/api/mobile/analytics/export',
      '/api/mobile/ai-authoring/status',
      '/api/mobile/ai-authoring/drafts',
    ].includes(path)
  )
    return true;
  if (
    method === 'POST' &&
    ['/api/mobile/teaching-announcements', '/api/mobile/ai-authoring/drafts'].includes(path)
  )
    return true;
  if (
    ['GET', 'DELETE'].includes(method) &&
    /^\/api\/mobile\/ai-authoring\/drafts\/[A-Za-z0-9_-]{1,100}$/.test(path)
  )
    return true;
  return (
    method === 'POST' && /^\/api\/mobile\/ai-authoring\/drafts\/[A-Za-z0-9_-]{1,100}\/commit$/.test(path)
  );
}
