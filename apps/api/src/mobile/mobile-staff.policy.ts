const collections = new Set([
  'catalog',
  'grants',
  'roles',
  'people',
  'users',
  'majors',
  'classes',
  'terms',
  'organizations',
  'jobs',
  'join-requests',
  'questions',
  'assignments',
  'exams',
]);
const writable = new Set([
  'grants',
  'majors',
  'subjects',
  'users',
  'classes',
  'terms',
  'organizations',
  'courses',
  'questions',
  'assignments',
  'exams',
]);
export function mobileStaffRouteAllowed(path: string, method: string) {
  if (/^\/api\/mobile\/staff\/(users|organizations)\/[A-Za-z0-9_-]{1,100}$/.test(path))
    return method === 'PATCH';
  if (
    /^\/api\/mobile\/staff\/(?:users\/[A-Za-z0-9_-]{1,100}\/recovery|organizations\/[A-Za-z0-9_-]{1,100}\/admins)$/.test(
      path,
    )
  )
    return method === 'POST';

  if (path === '/api/mobile/staff/join-settings') return method === 'GET' || method === 'PATCH';
  if (path === '/api/mobile/staff/join-settings/rotate') return method === 'POST';
  if (/^\/api\/mobile\/staff\/courses\/[A-Za-z0-9_-]{1,100}\/members$/.test(path))
    return method === 'GET' || method === 'POST';
  if (
    method === 'GET' &&
    /^\/api\/mobile\/staff\/grading(?:\/(?:assignments\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+|(?:exams|appeals)\/[a-zA-Z0-9_-]+))?\/?$/.test(
      path,
    )
  )
    return true;
  if (
    method === 'PUT' &&
    /^\/api\/mobile\/staff\/grading\/(?:submissions|exams)\/[a-zA-Z0-9_-]+\/?$/.test(path)
  )
    return true;
  if (method === 'POST' && /^\/api\/mobile\/staff\/grading\/appeals\/[a-zA-Z0-9_-]+\/?$/.test(path))
    return true;
  if (/^\/api\/mobile\/staff\/classes\/[A-Za-z0-9_-]{1,100}\/members$/.test(path))
    return method === 'GET' || method === 'POST';
  if (/^\/api\/mobile\/staff\/classes\/[A-Za-z0-9_-]{1,100}\/courses$/.test(path)) return method === 'POST';
  if (/^\/api\/mobile\/staff\/(?:majors|subjects|roles)\/[A-Za-z0-9_-]{1,100}$/.test(path))
    return method === 'PATCH';
  if (/^\/api\/mobile\/staff\/grants\/[A-Za-z0-9_-]{1,100}$/.test(path)) return method === 'DELETE';
  const parts = /^\/api\/mobile\/staff\/([a-z-]+)(?:\/([A-Za-z0-9_-]{1,100})(?:\/([a-z-]+))?)?\/?$/.exec(
    path,
  );
  if (!parts) return false;
  const [, group, id, action] = parts;
  if (!id) return method === 'GET' ? collections.has(group) : method === 'POST' && writable.has(group);
  if (method === 'PATCH')
    return (
      (group === 'users' && action === 'major') ||
      (group === 'join-requests' && !action) ||
      (group === 'courses' && action === 'status')
    );
  return (
    method === 'POST' &&
    ((group === 'courses' && action === 'chapters') ||
      (group === 'chapters' && action === 'lessons') ||
      (['assignments', 'exams'].includes(group) && (action === 'publish' || action === 'release')))
  );
}
