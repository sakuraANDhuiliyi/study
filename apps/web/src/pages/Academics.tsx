import { useState } from 'react';
import { Button, Input, Pagination, Select, Tag } from 'antd';
import {
  ArrowRight,
  BookOpen,
  Calculator,
  CalendarDays,
  Code2,
  GraduationCap,
  NotebookPen,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { date, useData } from '../api';
import { EmptyState, PageTitle, Panel, QueryState } from '../components/shared';
import { LearningPreferences } from '../components/academics/Preferences';
import { LearningGoals } from '../components/academics/Goals';
import { ActionPanel } from '../components/learning/ActionPanel';
import { kindLabels } from '../components/academics/types';
import type { AcademicHomeData, Catalog, ModuleSummary } from '../components/academics/types';
import '../academics.css';

export function ModuleCard({ module, selected }: { module: ModuleSummary; selected?: boolean }) {
  const Icon =
    module.kind === 'calculator'
      ? Calculator
      : module.kind === 'algorithm' || module.kind === 'sql'
        ? Code2
        : module.kind === 'workspace'
          ? NotebookPen
          : BookOpen;
  return (
    <Link
      className="academic-module-card"
      to={module.kind === 'algorithm' ? '/algorithms' : `/academics/modules/${module.id}`}
    >
      <div className="academic-module-top">
        <span className={`academic-module-icon kind-${module.kind}`}>
          <Icon size={22} />
        </span>
        <span>{kindLabels[module.kind]}</span>
        {selected && <Tag color="blue">已加入</Tag>}
      </div>
      <h3>{module.title}</h3>
      <p>{module.description}</p>
      <div className="academic-module-tags">
        {module.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <footer>
        <span>约 {module.estimatedMinutes} 分钟</span>
        <span>
          开始学习 <ArrowRight size={15} />
        </span>
      </footer>
    </Link>
  );
}

export function Academics({ home = false }: { home?: boolean }) {
  const { user } = useAuth();
  return <LearningCenter key={`${user?.organizationId}:${user?.id}:${user?.role}`} home={home} />;
}
function LearningCenter({ home }: { home: boolean }) {
  const { user, refresh } = useAuth();
  const catalog = useData<Catalog>('/academics/catalog');
  const me = useData<AcademicHomeData>('/academics/me');
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState<string>();
  const [kind, setKind] = useState<string>();
  const [onlyMine, setOnlyMine] = useState(false);
  const [page, setPage] = useState(1);
  const selected = me.data?.selectedModuleIds || [];
  const visible = (catalog.data?.modules || []).filter(
    (module) =>
      (!subject || module.subjectIds.includes(subject)) &&
      (!kind || module.kind === kind) &&
      (!onlyMine || selected.includes(module.id)) &&
      `${module.title} ${module.description} ${module.tags.join(' ')}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="academic-page">
      <PageTitle
        eyebrow={home ? 'MY LEARNING SPACE' : 'SUBJECT LEARNING'}
        title={home ? '我的学习空间' : '专业学习中心'}
        description={
          home
            ? `${user?.name || '同学'}，按照你的专业和兴趣，安排今天的学习。`
            : '从概念理解到动手实验，把每一次计算、练习与思考积累为自己的学习记录。'
        }
        extra={
          <Button
            icon={<Settings2 size={16} />}
            disabled={!catalog.data || !me.data}
            onClick={() => setSettings(true)}
          >
            定制学习模块
          </Button>
        }
      />
      <QueryState query={me}>
        {me.data && (
          <>
            <section className="academic-hero">
              <div>
                <span className="academic-eyebrow">
                  <GraduationCap size={16} />
                  {me.data.accountMode === 'PERSONAL' ? '自主学习' : '专业成长'}
                </span>
                <h2>{me.data.major?.name || '从一个感兴趣的领域开始'}</h2>
                <p>
                  {me.data.major?.description ||
                    '你可以自由选择学习模块，也可以选择专业后加入对应的推荐模块。'}
                </p>
                <Button type="primary" onClick={() => setSettings(true)}>
                  {selected.length ? '调整我的学习计划' : '选择专业与模块'}
                  <ArrowRight size={16} />
                </Button>
              </div>
              <div className="academic-hero-stats">
                <div>
                  <strong>{me.data.stats.records}</strong>
                  <span>学习记录</span>
                </div>
                <div>
                  <strong>{me.data.stats.completed}</strong>
                  <span>已完成练习</span>
                </div>
                <div>
                  <strong>{me.data.stats.modulesPracticed}</strong>
                  <span>已探索模块</span>
                </div>
              </div>
            </section>
            {home && <ActionPanel />}
            <LearningGoals modules={catalog.data?.modules || []} />
            <div className="academic-quicklinks">
              <Link to="/planner">
                <CalendarDays size={19} />
                <span>安排学习日历</span>
                <ArrowRight size={14} />
              </Link>
              <Link to="/academics/records">
                <NotebookPen size={19} />
                <span>学习记录与笔记</span>
                <ArrowRight size={14} />
              </Link>
              <Link to="/ai-study">
                <Sparkles size={19} />
                <span>AI 学习复盘</span>
                <ArrowRight size={14} />
              </Link>
            </div>
            {home && (
              <Panel
                title={selected.length ? '我的学习模块' : '推荐从这里开始'}
                description={
                  selected.length
                    ? '只展示你主动选择的模块，随时可以调整。'
                    : '按专业与当前目录推荐，完成练习后可回看真实记录。'
                }
              >
                <div className="academic-module-grid">
                  {(selected.length
                    ? catalog.data?.modules.filter((module) => selected.includes(module.id)) || []
                    : me.data.recommendations
                  ).map((module) => (
                    <ModuleCard key={module.id} module={module} selected={selected.includes(module.id)} />
                  ))}
                </div>
                {selected.length > 0 && !catalog.data && <p>正在载入已选模块…</p>}
              </Panel>
            )}
          </>
        )}
      </QueryState>
      <section className="academic-library">
        <div className="academic-section-heading">
          <div>
            <h2>探索专业学习模块</h2>
            <p>选择学科和练习方式，找到下一项值得动手尝试的内容。</p>
          </div>
          <span>{visible.length} 个模块</span>
        </div>
        <div className="academic-filter-bar">
          <Input.Search
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            allowClear
            aria-label="搜索学习模块"
            placeholder="搜索模块、知识点或技能"
          />
          <Select
            aria-label="学科筛选"
            allowClear
            placeholder="全部学科"
            value={subject}
            onChange={(value) => {
              setSubject(value);
              setPage(1);
            }}
            options={catalog.data?.subjects.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Select
            aria-label="练习方式筛选"
            allowClear
            placeholder="全部练习方式"
            value={kind}
            onChange={(value) => {
              setKind(value);
              setPage(1);
            }}
            options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}
          />
          <Button
            type={onlyMine ? 'primary' : 'default'}
            onClick={() => {
              setOnlyMine(!onlyMine);
              setPage(1);
            }}
          >
            只看已选
          </Button>
        </div>
        <QueryState query={catalog}>
          {visible.length ? (
            <div className="academic-module-grid">
              {visible.slice((page - 1) * 12, page * 12).map((module) => (
                <ModuleCard key={module.id} module={module} selected={selected.includes(module.id)} />
              ))}
            </div>
          ) : (
            <EmptyState
              description={
                onlyMine
                  ? '还没有符合条件的已选模块，可以通过“定制学习模块”添加。'
                  : '没有找到符合条件的模块，试试调整筛选条件。'
              }
            />
          )}
        </QueryState>
        {visible.length > 12 && (
          <Pagination
            style={{ marginTop: 24 }}
            current={page}
            total={visible.length}
            pageSize={12}
            showSizeChanger={false}
            onChange={setPage}
          />
        )}
      </section>
      {!!me.data?.recentRecords.length && (
        <Panel title="最近的学习足迹" extra={<Link to="/academics/records">查看全部记录</Link>}>
          <div className="academic-recent">
            {me.data.recentRecords.map((record) => (
              <Link key={record.id} to={`/academics/records?moduleId=${record.moduleId}`}>
                <span className="academic-recent-icon">
                  <NotebookPen size={18} />
                </span>
                <div>
                  <strong>{record.title}</strong>
                  <p>
                    {date(record.updatedAt)} · {record.status === 'COMPLETED' ? '已完成' : '继续研究'}
                  </p>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </Panel>
      )}
      {settings && me.data && catalog.data && (
        <LearningPreferences
          data={me.data}
          catalog={catalog.data}
          onClose={() => setSettings(false)}
          onRefresh={async () => (await me.refetch()).data}
          onSaved={async () => {
            await me.refetch();
            await refresh();
          }}
        />
      )}
    </div>
  );
}
