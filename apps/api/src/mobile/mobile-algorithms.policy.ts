/** Only these native endpoints may delegate to the existing isolated Judge0 workflow. */
export function mobileAlgorithmExecutionRouteAllowed(path: string, method: string) {
  if (mobileAlgorithmLearningRouteAllowed(path, method)) return true;
  if (method === 'GET')
    return (
      /^\/api\/mobile\/algorithms\/status\/?$/.test(path) ||
      /^\/api\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/(workspace|submissions)\/?$/.test(path) ||
      /^\/api\/mobile\/algorithms\/submissions\/[A-Za-z0-9_-]{1,100}\/?$/.test(path)
    );
  if (method === 'PUT')
    return /^\/api\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/draft\/?$/.test(path);
  return (
    method === 'POST' &&
    /^\/api\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/submissions\/?$/.test(path)
  );
}
export function mobileAlgorithmLearningRouteAllowed(path: string, method: string) {
  if (['GET', 'POST'].includes(method) && /^\/api\/mobile\/algorithms\/training-plans\/?$/.test(path))
    return true;
  if (
    ['PATCH', 'DELETE'].includes(method) &&
    /^\/api\/mobile\/algorithms\/training-plans\/[A-Za-z0-9_-]{1,100}\/?$/.test(path)
  )
    return true;
  if (method === 'GET')
    return (
      /^\/api\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/analyses\/?$/.test(path) ||
      /^\/api\/mobile\/algorithms\/forum\/(?:status|posts(?:\/[A-Za-z0-9_-]{1,100}(?:\/replies)?)?)\/?$/.test(
        path,
      )
    );
  return (
    method === 'POST' &&
    (/^\/api\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/analysis\/?$/.test(path) ||
      /^\/api\/mobile\/algorithms\/forum\/posts(?:\/[A-Za-z0-9_-]{1,100}\/replies)?\/?$/.test(path))
  );
}
