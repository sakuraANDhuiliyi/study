import { useState } from 'react';
import { App, Button, Modal, Pagination, Popconfirm, Select, Tag } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, date, queryString, useData } from '../api';
import { EmptyState, PageTitle, Panel, QueryState } from '../components/shared';
import { RecordEditor } from '../components/academics/RecordEditor';
import { ResultView } from '../components/academics/ResultView';
import type { Catalog, LearningRecord } from '../components/academics/types';
import '../academics.css';
export function AcademicRecords({ notes = false }: { notes?: boolean }) {
  const { user } = useAuth();
  return <Records key={`${user?.organizationId}:${user?.id}`} notes={notes} />;
}
function Records({ notes }: { notes: boolean }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const moduleId = params.get('moduleId') || undefined;
  const query = useData<{ items: LearningRecord[]; total: number }>(
    `/academics/records?${queryString({ moduleId, page, pageSize: 12 })}`,
  );
  const catalog = useData<Catalog>('/academics/catalog');
  const { message } = App.useApp();
  const [detail, setDetail] = useState<LearningRecord | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  async function remove(id: string) {
    setDeleting(id);
    try {
      await api(`/academics/records/${id}`, { method: 'DELETE' });
      try {
        localStorage.removeItem(`academic-record-note:${user?.organizationId}:${user?.id}:${id}`);
      } catch {
        /* The server record has been removed. */
      }
      await query.refetch();
      message.success('学习记录已删除');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setDeleting(null);
    }
  }
  return (
    <div className="academic-page">
      <PageTitle
        eyebrow="MY LEARNING RECORDS"
        title={notes ? '我的学习笔记' : '学习记录与笔记'}
        description="保存实验结果、练习思考与自由笔记，所有内容仅自己可见。"
        extra={
          <Link to="/academics/modules/study-notebook">
            <Button type="primary" icon={<Plus size={16} />}>
              写一篇学习笔记
            </Button>
          </Link>
        }
      />
      <div className="academic-filter-bar">
        <Select
          aria-label="学习记录模块"
          value={moduleId}
          allowClear
          placeholder="全部学习模块"
          options={catalog.data?.modules.map((item) => ({ value: item.id, label: item.title }))}
          onChange={(value) => {
            setParams(value ? { moduleId: value } : {});
            setPage(1);
          }}
        />
        <Button onClick={() => query.refetch()}>刷新记录</Button>
        <span>共 {query.data?.total ?? '—'} 条</span>
      </div>
      <QueryState query={query}>
        {query.data?.items.length ? (
          <>
            <div className="academic-record-grid">
              {query.data.items.map((record) => (
                <Panel key={record.id}>
                  <div className="academic-record-card">
                    <Tag color={record.status === 'COMPLETED' ? 'green' : 'default'}>
                      {record.status === 'COMPLETED' ? '已完成' : '继续研究'}
                    </Tag>
                    <h2>{record.title}</h2>
                    <span>
                      {catalog.data?.modules.find((item) => item.id === record.moduleId)?.title ||
                        record.moduleId}
                    </span>
                    <p>
                      {record.notes ||
                        (typeof record.values.body === 'string' ? record.values.body : record.result.summary)}
                    </p>
                    <small>{date(record.updatedAt)}</small>
                    <div>
                      <Button type="primary" onClick={() => setDetail(record)}>
                        查看与编辑
                      </Button>
                      <Popconfirm
                        title="删除这条学习记录及笔记？"
                        description="删除后无法恢复。"
                        okText="删除记录"
                        cancelText="取消"
                        onConfirm={() => remove(record.id)}
                      >
                        <Button
                          aria-label={`删除${record.title}`}
                          danger
                          icon={<Trash2 size={15} />}
                          loading={deleting === record.id}
                        />
                      </Popconfirm>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
            <Pagination
              current={page}
              total={query.data.total}
              pageSize={12}
              showSizeChanger={false}
              onChange={setPage}
            />
          </>
        ) : (
          <EmptyState description="还没有学习记录。完成一次模块练习，或直接写一篇自由笔记。">
            <Link to="/academics">
              <Button>探索学习模块</Button>
            </Link>
          </EmptyState>
        )}
      </QueryState>
      <Modal
        open={!!detail}
        width={880}
        title="学习记录详情"
        onCancel={() => setDetail(null)}
        footer={null}
        destroyOnHidden
      >
        {detail && (
          <div className="academic-record-detail">
            <ResultView result={detail.result} />
            <RecordEditor
              key={detail.id}
              record={detail}
              onSaved={(record) => {
                setDetail(record);
                void query.refetch();
              }}
              onRefresh={async () =>
                (await query.refetch()).data?.items.find((item) => item.id === detail.id)
              }
            />
            <Link to={`/academics/modules/${detail.moduleId}`}>
              <Button>回到模块继续练习</Button>
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}
