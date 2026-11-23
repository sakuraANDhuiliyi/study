export function mobileLessonMediaRouteAllowed(path: string, method: string) {
  return (
    ['GET', 'HEAD'].includes(method) &&
    /^\/api\/mobile\/lessons\/[A-Za-z0-9_-]{1,100}\/media\/[A-Za-z0-9_-]{1,100}$/.test(path)
  );
}
