const project = '[A-Za-z0-9_-]{1,100}';
export function mobileAndroidStudioRouteAllowed(path: string, method: string) {
  const base = '/api/mobile/android-studio';
  if (method === 'GET')
    return new RegExp(
      `^${base}/(?:status|templates|projects|projects/${project}(?:/files|/file|/jobs|/build|/apk|/source|/logs/${project})?|jobs/${project}(?:/approvals)?)$`,
    ).test(path);
  if (method === 'POST')
    return new RegExp(
      `^${base}/(?:projects|projects/${project}/(?:generate|build|build/cancel)|jobs/${project}/(?:cancel|approvals/${project}))$`,
    ).test(path);
  return method === 'PUT' && new RegExp(`^${base}/projects/${project}/file$`).test(path);
}
