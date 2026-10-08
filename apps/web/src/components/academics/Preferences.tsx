import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Popconfirm, Select, Tag } from 'antd';
import { ApiError, send } from '../../api';
import type { AcademicHomeData, Catalog, Preferences as PreferenceValues } from './types';
import { kindLabels } from './types';

export function LearningPreferences({
  data,
  catalog,
  onClose,
  onSaved,
  onRefresh,
}: {
  data: AcademicHomeData;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  onRefresh: () => Promise<AcademicHomeData | undefined>;
}) {
  const [majorId, setMajorId] = useState<string | null>(data.majorId || null);
  const [selected, setSelected] = useState(data.selectedModuleIds);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(data.revision);
  const [conflict, setConflict] = useState<AcademicHomeData | null>(null);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function save(base = revision) {
    setBusy(true);
    setError('');
    try {
      const saved = (await send(
        '/academics/preferences',
        {
          revision: base,
          selectedModuleIds: selected,
          ...(data.accountMode === 'PERSONAL' ? { majorId } : {}),
        },
        'PATCH',
      )) as PreferenceValues;
      if (!live.current) return;
      setRevision(saved.revision);
      await onSaved();
      if (live.current) onClose();
    } catch (err) {
      if (!live.current) return;
      if (err instanceof ApiError && err.status === 409) {
        const fresh = await onRefresh();
        if (!live.current) return;
        if (fresh) setConflict(fresh);
        setError('学习设置已在其他窗口更新，你的选择已保留。');
      } else setError((err as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const availableMajors =
    data.major && !catalog.majors.some((item) => item.id === data.major!.id)
      ? [...catalog.majors, data.major]
      : catalog.majors;
  const major = availableMajors.find((item) => item.id === majorId);
  return (
    <Modal
      open
      title="定制我的学习空间"
      width={780}
      onCancel={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={busy} disabled={!!conflict} onClick={() => save()}>
            保存学习设置
          </Button>
        </>
      }
    >
      <div className="academic-preferences">
        <label>
          我的专业
          <Select
            aria-label="我的专业"
            value={majorId}
            allowClear
            disabled={data.accountMode !== 'PERSONAL'}
            placeholder="不限专业，自由探索"
            options={availableMajors.map((item) => ({
              value: item.id,
              label: `${item.name}${item.active === false ? '（已归档）' : ''}`,
              disabled: item.active === false,
            }))}
            onChange={(value) => setMajorId(value || null)}
          />
        </label>
        {data.accountMode !== 'PERSONAL' && (
          <p className="form-hint">组织学生的专业由管理员指定，你仍然可以自由扩展学习模块。</p>
        )}
        {major && (
          <div className="academic-major-suggestion">
            <p>{major.description}</p>
            <Button
              onClick={() => setSelected((current) => Array.from(new Set([...current, ...major.moduleIds])))}
            >
              加入该专业推荐模块
            </Button>
          </div>
        )}
        <div className="academic-preference-toolbar">
          <strong>选择学习模块 · 已选 {selected.length}</strong>
          <Input.Search
            allowClear
            aria-label="搜索可选模块"
            placeholder="搜索模块或知识点"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="academic-module-choices">
          {catalog.modules
            .filter((module) => `${module.title} ${module.tags.join(' ')}`.includes(search.trim()))
            .map((module) => (
              <Checkbox
                key={module.id}
                aria-label={module.title}
                className={`academic-module-choice ${selected.includes(module.id) ? 'is-selected' : ''}`}
                checked={selected.includes(module.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, module.id] : current.filter((id) => id !== module.id),
                  )
                }
              >
                <div>
                  <strong>{module.title}</strong>
                  <Tag>{kindLabels[module.kind]}</Tag>
                  <p>{module.description}</p>
                </div>
              </Checkbox>
            ))}
        </div>
        {error && <Alert type="error" message={error} />}
        {conflict && (
          <div className="academic-conflict">
            <p>
              服务器最新设置已选 {conflict.selectedModuleIds.length} 个模块，版本 {conflict.revision}。
            </p>
            <Popconfirm
              title="使用当前选择更新最新设置？"
              okText="保存我的选择"
              cancelText="取消"
              onConfirm={() => save(conflict.revision)}
            >
              <Button loading={busy}>保留我的选择并重新保存</Button>
            </Popconfirm>
          </div>
        )}
      </div>
    </Modal>
  );
}
