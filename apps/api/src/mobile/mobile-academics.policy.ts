/** Native academics grants only the student's shared learning workflows, never directory administration. */
export function mobileAcademicRouteAllowed(path: string, method: string) {
  const root = '/api/mobile/academics';
  if (
    method === 'GET' &&
    [root + '/catalog', root + '/me', root + '/records', root + '/goals'].includes(path)
  )
    return true;
  if (method === 'POST' && [root + '/goals', root + '/records/export'].includes(path)) return true;
  if (
    ['PATCH', 'DELETE'].includes(method) &&
    /^\/api\/mobile\/academics\/goals\/[A-Za-z0-9_-]{1,100}$/.test(path)
  )
    return true;
  if (method === 'PATCH' && path === root + '/preferences') return true;
  if (method === 'GET' && /^\/api\/mobile\/academics\/modules\/[A-Za-z0-9_-]{1,100}$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/mobile\/academics\/modules\/[A-Za-z0-9_-]{1,100}\/evaluate$/.test(path))
    return true;
  return (
    ['GET', 'PATCH', 'DELETE'].includes(method) &&
    /^\/api\/mobile\/academics\/records\/[A-Za-z0-9_-]{1,100}$/.test(path)
  );
}
