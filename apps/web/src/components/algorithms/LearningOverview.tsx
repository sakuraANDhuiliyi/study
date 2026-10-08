import { Button, Collapse, Progress, Tag, Tooltip } from 'antd';
import { ArrowRight, CalendarDays, CheckCircle2, Flame, Route, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '../../api';
import { QueryState } from '../shared';
import type { ProblemCard } from './types';
type Overview = {
  dailyProblem: ProblemCard;
  recommendation: ProblemCard | null;
  activity: { date: string; submissions: number; solved: number }[];
  stats: { submitted: number; accepted: number; solved: number; streak: number };
  plans: {
    id: string;
    title: string;
    description: string;
    level: string;
    estimatedDays: number;
    chapters: { title: string; description: string; problemIds: string[]; problems?: ProblemCard[] }[];
    total: number;
    solved: number;
    nextProblemId: string | null;
  }[];
};
function RecommendedProblem({
  problem,
  label,
  description,
  icon: Icon,
}: {
  problem: ProblemCard;
  label: string;
  description: string;
  icon: typeof Target;
}) {
  return (
    <Link className="algo-recommended" to={`/algorithms/${problem.id}`}>
      <div className="algo-recommended-label">
        <Icon size={16} />
        <span>{label}</span>
        {problem.status === 'solved' && <Tag color="green">已完成</Tag>}
      </div>
      <strong>
        {String(problem.number).padStart(3, '0')} · {problem.title}
      </strong>
      <p>{description}</p>
      <div>
        <span>{problem.tags.join(' · ')}</span>
        <ArrowRight size={17} />
      </div>
    </Link>
  );
}
export function LearningOverview() {
  const query = useData<Overview>('/algorithms/overview');
  return (
    <QueryState query={query}>
      {query.data && (
        <div className="algo-learning-overview">
          <div className="algo-daily-grid">
            <RecommendedProblem
              problem={query.data.dailyProblem}
              label="每日一题"
              description="每天解决一个小问题，积累可迁移的解题方法。"
              icon={CalendarDays}
            />
            {query.data.recommendation ? (
              <RecommendedProblem
                problem={query.data.recommendation}
                label="下一道，练这个"
                description="优先回顾待复习题，再继续尚未解决的挑战。"
                icon={Target}
              />
            ) : (
              <div className="algo-recommended algo-all-done">
                <CheckCircle2 size={24} />
                <strong>当前题库已全部完成</strong>
                <p>回看笔记，尝试另一种解法或复习边界条件。</p>
              </div>
            )}
            <div className="algo-activity-card">
              <div className="algo-activity-heading">
                <strong>近 28 天练习</strong>
                <span>
                  <Flame size={14} />
                  连续 {query.data.stats.streak} 天
                </span>
              </div>
              <div className="algo-activity-grid" aria-label="最近28天提交活动">
                {query.data.activity.map((day) => (
                  <Tooltip
                    key={day.date}
                    title={`${day.date}：${day.submissions} 次正式提交，${day.solved} 道通过`}
                  >
                    <span
                      tabIndex={0}
                      aria-label={`${day.date}，${day.submissions} 次正式提交，${day.solved} 道通过`}
                      data-level={
                        day.submissions === 0 ? 0 : day.submissions < 3 ? 1 : day.submissions < 6 ? 2 : 3
                      }
                    />
                  </Tooltip>
                ))}
              </div>
              <div className="algo-activity-legend">
                <span>
                  {query.data.stats.submitted} 次正式提交 · {query.data.stats.solved} 道已解决
                </span>
                <span>
                  少<i data-level="0" />
                  <i data-level="1" />
                  <i data-level="3" />多
                </span>
              </div>
            </div>
          </div>
          <section className="algo-panel algo-plans">
            <div className="algo-panel-heading">
              <div>
                <h2>
                  <Route size={18} />
                  按计划稳步进阶
                </h2>
                <p>按章节练习，在完成一道道题的过程中建立知识结构。</p>
              </div>
              <span className="algo-muted">{query.data.plans.length} 条学习路径</span>
            </div>
            <Collapse
              ghost
              items={query.data.plans.map((plan) => ({
                key: plan.id,
                label: (
                  <div className="algo-plan-summary">
                    <div>
                      <strong>{plan.title}</strong>
                      <span>{plan.description}</span>
                    </div>
                    <div className="algo-plan-progress">
                      <span>
                        {plan.solved} / {plan.total} 题
                      </span>
                      <Progress
                        percent={plan.total ? Math.round((plan.solved / plan.total) * 100) : 0}
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  </div>
                ),
                children: (
                  <div className="algo-plan-content">
                    <div className="algo-plan-meta">
                      <span>
                        {plan.level} · 建议 {plan.estimatedDays} 天
                      </span>
                      {plan.nextProblemId ? (
                        <Link to={`/algorithms/${plan.nextProblemId}`}>
                          <Button size="small" type="primary">
                            继续学习 <ArrowRight size={13} />
                          </Button>
                        </Link>
                      ) : (
                        <Tag color="green">已完成此计划</Tag>
                      )}
                    </div>
                    {plan.chapters.map((chapter, index) => (
                      <section key={chapter.title} className="algo-plan-chapter">
                        <h3>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          {chapter.title}
                        </h3>
                        <p>{chapter.description}</p>
                        <div>
                          {(chapter.problems || []).map((problem) => (
                            <Link key={problem.id} to={`/algorithms/${problem.id}`}>
                              <span>
                                {problem.status === 'solved' ? (
                                  <CheckCircle2 size={15} className="is-solved" />
                                ) : (
                                  <span className="algo-chapter-dot" />
                                )}
                                {problem.title}
                              </span>
                              <span>
                                {{ easy: '简单', medium: '中等', hard: '困难' }[problem.difficulty]}
                                <ArrowRight size={13} />
                              </span>
                            </Link>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ),
              }))}
            />
          </section>
        </div>
      )}
    </QueryState>
  );
}
