export function mobilePersonalLearningRouteAllowed(path: string, method: string) {
  const base = '/api/mobile/personal';
  if (
    method === 'GET' &&
    new RegExp('^' + base + '/(?:notes(?:/standalone)?|lesson-notes|focus/(?:sessions|summary))/?$').test(
      path,
    )
  )
    return true;
  if (
    ['GET', 'PATCH', 'DELETE'].includes(method) &&
    new RegExp('^' + base + '/notes/standalone/[A-Za-z0-9_-]{1,100}/?$').test(path)
  )
    return true;
  if (
    ['GET', 'PUT', 'DELETE'].includes(method) &&
    new RegExp('^' + base + '/lessons/[A-Za-z0-9_-]{1,100}/note/?$').test(path)
  )
    return true;
  if (
    ['GET', 'DELETE'].includes(method) &&
    new RegExp('^' + base + '/focus/sessions/[A-Za-z0-9_-]{1,100}/?$').test(path)
  )
    return true;
  return method === 'POST' && new RegExp('^' + base + '/(?:notes/standalone|focus/sessions)/?$').test(path);
}
