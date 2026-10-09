// Existing feature fixtures have no planner tasks. Keep their student home
// response explicit so unrelated login/identity checks exercise a valid contract.
export function emptyLearningActions(url: URL) {
  return {
    items: [],
    counts: { today: 0, upcoming: 0, overdue: 0 },
    total: 0,
    page: Number(url.searchParams.get('page') || 1),
    pageSize: Number(url.searchParams.get('pageSize') || 10),
    bucket: url.searchParams.get('bucket') || 'today',
    timezone: 'Asia/Shanghai',
    serverTime: '2026-10-10T04:00:00.000Z',
    range: {
      todayStart: '2026-10-09T16:00:00.000Z',
      tomorrowStart: '2026-10-10T16:00:00.000Z',
      upcomingEnd: '2026-10-17T16:00:00.000Z',
    },
  };
}
