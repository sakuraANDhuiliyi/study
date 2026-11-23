import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture } from './live.fixture';
import { MobileClient, MobileApiError } from '../apps/mobile/src/client';
import {
  teachingRoot as root,
  teachingApi,
  type TeachingQuestion,
  type TeachingPaper,
  type TeachingAssessment,
  type TeachingChapter,
  type TeachingLesson,
  type TeachingRoster,
  type TeachingFile,
  type TeachingPage,
} from '../apps/mobile/src/teaching-model';

test(
  'native teacher operations preserve course scope, frozen versions, CAS and private resource boundaries',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let saved: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => saved,
          set: async (v) => {
            saved = v;
          },
          remove: async () => {
            saved = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number | number[]) =>
      assert.rejects(
        p,
        (e) => e instanceof MobileApiError && (Array.isArray(status) ? status : [status]).includes(e.status),
      );
    const at = (n: number) => new Date(Date.now() + n).toISOString();
    try {
      const teacher = await mobile(f.users.teacher.username),
        other = await mobile(f.users.otherTeacher.username),
        student = await mobile(f.users.student.username),
        foreign = await mobile(f.users.outsider.username);
      const original = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'single',
          stem: '原始题干',
          options: [
            { id: 'A', text: '一' },
            { id: 'B', text: '二' },
          ],
          answer: 'A',
          explanation: '原始解析',
          scoreCents: 1000,
        })
      ).body as TeachingQuestion;
      let revised = original,
        paper: TeachingPaper,
        assignment: TeachingAssessment,
        exam: TeachingAssessment,
        chapter: TeachingChapter,
        lesson: TeachingLesson;
      await t.test(
        'native current staff identity and strict routing never bypass web CSRF, course enrollment or bounded query parsing',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + root + '/papers')).status, 401);
          for (const c of [student, foreign]) await denied(c.request(root + '/courses'), 403);
          await denied(other.request(root + '/courses/' + f.course.id), [403, 404]);
          await f.call(f.clients.teacher, root + '/papers', 'GET', undefined, 403);
          await f.call(
            f.clients.teacher,
            '/papers',
            'POST',
            { courseId: f.course.id, title: '无CSRF', questionVersionIds: [original.versions[0].id] },
            403,
            false,
          );
          await denied(teacher.request('/questions/' + original.id), 403);
          for (const query of ['?organizationId=' + f.foreign.id, '?page=1&page=2', '?pageSize=21'])
            await denied(teacher.request(root + '/questions' + query), 400);
          assert.equal(
            (
              await teacher.request<TeachingPage<TeachingQuestion>>(
                root + '/questions?courseId=' + f.course.id,
              )
            ).total,
            1,
          );
        },
      );
      await t.test(
        'paper snapshots stay on old versions, native revision is CAS, and shared copies never grant edit ownership',
        async () => {
          paper = await teacher.request<TeachingPaper>(
            root + '/papers',
            { courseId: f.course.id, title: '固定版本试卷', questionVersionIds: [original.versions[0].id] },
            'POST',
          );
          revised = await teachingApi.revise(teacher, original.id, 1, {
            stem: '修订题干',
            answer: 'B',
            explanation: '修订解析',
            scope: 'shared',
          });
          assert.equal(revised.currentVersion, 2);
          await denied(teachingApi.revise(teacher, original.id, 1, { stem: '不应覆盖' }), 409);
          const versions = await teacher.request<TeachingPage<{ version: number; stem: string }>>(
            root + '/questions/' + original.id + '/versions',
          );
          assert.deepEqual(
            versions.items.map((v) => [v.version, v.stem]),
            [
              [2, '修订题干'],
              [1, '原始题干'],
            ],
          );
          const pages = await teacher.request<TeachingPage<TeachingPaper>>(root + '/papers');
          assert.equal(pages.items[0].items[0].questionVersionId, original.versions[0].id);
          assert.equal(pages.items[0].items[0].questionVersion.stem, '原始题干');
          await f.db.teachingAssignment.create({
            data: { courseId: f.course.id, userId: f.users.otherTeacher.id },
          });
          await denied(teachingApi.revise(other, original.id, 2, { stem: '其他教师不可改' }), 403);
          const copy = await other.request<TeachingQuestion>(
            root + '/questions/' + original.id + '/copy',
            {},
            'POST',
          );
          assert.notEqual(copy.id, original.id);
          assert.equal(copy.creatorId, f.users.otherTeacher.id);
          assert.equal(copy.versions[0].stem, '修订题干');
          assert.equal((await other.request<TeachingPage<TeachingPaper>>(root + '/papers')).total, 0);
          await denied(teacher.request(root + '/questions/' + copy.id), [403, 404]);
        },
      );
      await t.test(
        'paper reuse creates real assignment and exam drafts, audience revisions conflict rather than overwrite',
        async () => {
          const ids = paper.items.map((i) => i.questionVersionId);
          assignment = await teacher.request<TeachingAssessment>(
            root + '/assignments',
            {
              courseId: f.course.id,
              title: '复用作业',
              opensAt: at(-60000),
              dueAt: at(3600000),
              questionVersionIds: ids,
              audienceIds: [f.users.student.id],
            },
            'POST',
          );
          const examQuestion = await teacher.request<TeachingQuestion>(
            root + '/questions/' + original.id + '/copy',
            {},
            'POST',
          );
          const examPaper = await teacher.request<TeachingPaper>(
            root + '/papers',
            {
              courseId: f.course.id,
              title: '独立保密考试试卷',
              questionVersionIds: [examQuestion.versions[0].id],
            },
            'POST',
          );
          exam = await teacher.request<TeachingAssessment>(
            root + '/exams',
            {
              courseId: f.course.id,
              title: '复用考试',
              startsAt: at(-60000),
              endsAt: at(3600000),
              entryClosesAt: at(1800000),
              durationMinutes: 30,
              passCents: 500,
              questionVersionIds: examPaper.items.map((i) => i.questionVersionId),
              audienceIds: [f.users.student.id],
              graderIds: [f.users.teacher.id],
            },
            'POST',
          );
          for (const [kind, row] of [
            ['assignments', assignment],
            ['exams', exam],
          ] as const) {
            await teachingApi.audience(teacher, kind, row, [f.users.student.id, f.users.student2.id]);
            await denied(teachingApi.audience(teacher, kind, row, [f.users.student3.id]), 409);
            const current = await teacher.request<TeachingAssessment>(root + '/' + kind + '/' + row.id);
            assert.equal(current.revision, row.revision + 1);
            assert.deepEqual(
              current.audience?.map((x) => x.userId).sort(),
              [f.users.student.id, f.users.student2.id].sort(),
            );
            await denied(teachingApi.audience(teacher, kind, current, [f.users.outsider.id]), 400);
            await teacher.request(root + '/' + kind + '/' + row.id + '/publish', {}, 'POST');
          }
          const saved = await f.db.assignmentItem.findMany({
            where: { assignmentId: assignment.id },
            include: { questionVersion: true },
          });
          assert.equal(saved[0].questionVersion.stem, '原始题干');
          const snapshot = await f.db.exam.findUniqueOrThrow({
            where: { id: exam.id },
            include: { snapshot: { include: { items: true } } },
          });
          assert.equal(snapshot.snapshot!.items[0].questionVersionId, examQuestion.versions[0].id);
        },
      );
      await t.test(
        'individual assignment allowance and return are audited, scoped and cannot return twice',
        async () => {
          await teacher.request(
            root + '/assignments/' + assignment.id + '/exceptions',
            {
              userId: f.users.student.id,
              reason: '批准补交安排',
              allowUntil: at(7200000),
              extraAttempts: 1,
              exempt: false,
            },
            'POST',
          );
          const submit = (
            await f.call(f.clients.student, '/assignments/' + assignment.id + '/submit', 'POST', {
              answers: [{ questionVersionId: original.versions[0].id, value: 'A' }],
              attachmentIds: [],
              idempotencyKey: 'native-teaching-submit-1',
            })
          ).body;
          const roster = await teacher.request<TeachingPage<TeachingRoster>>(
            root + '/assignments/' + assignment.id + '/roster',
          );
          assert.equal(roster.total, 2);
          assert.equal(
            roster.items.find((x) => x.user.id === f.users.student.id)?.exception?.extraAttempts,
            1,
          );
          await teacher.request(
            root + '/submissions/' + submit.id + '/return',
            { reason: '请补充解题说明' },
            'POST',
          );
          await denied(
            teacher.request(
              root + '/submissions/' + submit.id + '/return',
              { reason: '不能重复退回' },
              'POST',
            ),
            409,
          );
          assert.equal(
            (await f.db.assignmentSubmission.findUniqueOrThrow({ where: { id: submit.id } })).status,
            'returned',
          );
          assert.equal(
            (
              await f.db.assignmentException.findUniqueOrThrow({
                where: { assignmentId_userId: { assignmentId: assignment.id, userId: f.users.student.id } },
              })
            ).extraAttempts,
            2,
          );
          await denied(
            teacher.request(
              root + '/assignments/' + assignment.id + '/exceptions',
              { userId: f.users.outsider.id, reason: '跨机构不得批准', extraAttempts: 1 },
              'POST',
            ),
            400,
          );
          assert.ok(
            await f.db.auditLog.count({ where: { action: 'assignment.return', resourceId: submit.id } }),
          );
        },
      );
      await t.test(
        'exam eligibility cancellation and restoration preserve attempts, explicit extension cannot cross disclosure',
        async () => {
          const attempt = (await f.call(f.clients.student, '/exams/' + exam.id + '/start', 'POST')).body;
          await teacher.request(
            root + '/exams/' + exam.id + '/eligibility',
            { userId: f.users.student.id, eligible: false, reason: '核查考试资格' },
            'POST',
          );
          assert.equal(
            (await f.db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
            'cancelled',
          );
          await teacher.request(
            root + '/exams/' + exam.id + '/eligibility',
            { userId: f.users.student.id, eligible: true, reason: '已确认资格恢复' },
            'POST',
          );
          assert.equal(
            (await f.db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
            'cancelled',
          );
          const extension = await teacher.request<{ extraAttempts: number }>(
            root + '/exams/' + exam.id + '/extension',
            { userId: f.users.student.id, reason: '批准重新考试', deadlineAt: at(7200000), extraAttempts: 1 },
            'POST',
          );
          assert.equal(extension.extraAttempts, 1);
          await f.db.exam.update({
            where: { id: exam.id },
            data: { answerReleaseAt: new Date(Date.now() + 7200000) },
          });
          await denied(
            teacher.request(
              root + '/exams/' + exam.id + '/extension',
              {
                userId: f.users.student.id,
                reason: '公开答案后不可延时',
                deadlineAt: at(10800000),
                extraAttempts: 2,
              },
              'POST',
            ),
            409,
          );
          const roster = await teacher.request<TeachingPage<TeachingRoster>>(
            root + '/exams/' + exam.id + '/roster',
          );
          assert.equal(roster.items.find((x) => x.user.id === f.users.student.id)?.eligible, true);
          assert.equal(
            roster.items.find((x) => x.user.id === f.users.student.id)?.attempt?.status,
            'cancelled',
          );
        },
      );
      await t.test(
        'chapters and lessons preserve omitted fields and related tasks; private files require course reuse eligibility',
        async () => {
          chapter = await teacher.request<TeachingChapter>(
            root + '/courses/' + f.course.id + '/chapters',
            { title: '课件章节', sortOrder: 3 },
            'POST',
          );
          await teacher.request(
            root + '/chapters/' + chapter.id,
            { title: '修订章节', sortOrder: 2 },
            'PATCH',
          );
          const text = '本课程私有课件内容';
          const form = new FormData();
          form.append('file', new Blob([text], { type: 'text/plain' }), 'native-course.txt');
          const file = await teacher.request<TeachingFile>(
            root + '/courses/' + f.course.id + '/files',
            form,
            'POST',
            { multipart: true },
          );
          assert.equal(
            (await teacher.request<TeachingPage<TeachingFile>>(root + '/courses/' + f.course.id + '/files'))
              .total,
            1,
          );
          assert.equal(
            (await other.request<TeachingPage<TeachingFile>>(root + '/courses/' + f.course.id + '/files'))
              .total,
            0,
          );
          await denied(other.download(root + '/courses/' + f.course.id + '/files/' + file.id), 404);
          lesson = await teacher.request<TeachingLesson>(
            root + '/chapters/' + chapter.id + '/lessons',
            {
              title: '课件课时',
              content: '保留正文',
              type: 'DOCUMENT',
              attachmentId: file.id,
              sortOrder: 4,
              relatedTasks: [{ type: 'assignment', id: assignment.id }],
            },
            'POST',
          );
          const changed = await teacher.request<TeachingLesson>(
            root + '/lessons/' + lesson.id,
            { title: '修订课时' },
            'PATCH',
          );
          assert.equal(changed.content, '保留正文');
          assert.equal(changed.type, 'DOCUMENT');
          assert.equal(changed.attachmentId, file.id);
          assert.deepEqual(changed.relatedTasks, [{ type: 'assignment', id: assignment.id }]);
          assert.equal(
            (await other.request<TeachingPage<TeachingFile>>(root + '/courses/' + f.course.id + '/files'))
              .total,
            1,
          );
          const download = await other.download(root + '/courses/' + f.course.id + '/files/' + file.id);
          assert.equal(Buffer.from(download.bytes).toString('utf8'), text);
          assert.equal(download.contentType.split(';')[0], 'text/plain');
          await denied(student.download(root + '/courses/' + f.course.id + '/files/' + file.id), 403);
          await denied(
            teacher.request(root + '/lessons/' + lesson.id, { courseId: 'other', title: '不迁移' }, 'PATCH'),
            400,
          );
          await denied(
            teacher.request(root + '/lessons/' + lesson.id, { attachmentId: 'foreign-file' }, 'PATCH'),
            400,
          );
        },
      );
      await t.test(
        'revoked course membership, current permission and native session stop further private reads or writes',
        async () => {
          await f.db.teachingAssignment.updateMany({
            where: { courseId: f.course.id, userId: f.users.otherTeacher.id },
            data: { active: false },
          });
          await denied(other.request(root + '/courses/' + f.course.id + '/files'), [403, 404]);
          await f.db.rolePermission.delete({
            where: { roleId_permissionId: { roleId: 'TEACHER', permissionId: 'question.manage' } },
          });
          await denied(teacher.request(root + '/questions/' + original.id), 403);
          await denied(teachingApi.revise(teacher, original.id, 2, { stem: '权限撤销后不写入' }), 403);
          await f.db.session.deleteMany({
            where: { userId: f.users.teacher.id, clientType: 'MOBILE' },
          });
          await denied(teacher.request(root + '/papers'), 401);
          assert.equal(
            (await f.db.question.findUniqueOrThrow({ where: { id: original.id } })).currentVersion,
            2,
          );
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
