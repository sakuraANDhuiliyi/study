export function mobileAiStudyRouteAllowed(path: string, method: string) {
  const root = '/api/mobile/ai-study';
  if (method === 'GET' && [root + '/status', root + '/reports'].includes(path)) return true;
  if (method === 'POST' && path === root + '/reports') return true;
  if (
    ['GET', 'DELETE'].includes(method) &&
    /^\/api\/mobile\/ai-study\/reports\/[A-Za-z0-9_-]{1,100}$/.test(path)
  )
    return true;
  if (method === 'GET' && /^\/api\/mobile\/ai-study\/reports\/[A-Za-z0-9_-]{1,100}\/export$/.test(path))
    return true;
  return (
    method === 'POST' &&
    /^\/api\/mobile\/ai-study\/reports\/[A-Za-z0-9_-]{1,100}\/(?:search|sources\/[A-Za-z0-9_-]{1,100}\/download)$/.test(
      path,
    )
  );
}
