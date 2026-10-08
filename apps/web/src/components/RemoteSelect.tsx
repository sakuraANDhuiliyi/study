import { useEffect, useRef, useState } from 'react';
import { Pagination, Select } from 'antd';
import type { CSSProperties } from 'react';
import { queryString, useData } from '../api';

/** A paged, server-filtered selector. Selected labels survive page/search changes. */
export function RemoteSelect({
  id,
  endpoint,
  params = {},
  labelField = 'name',
  searchParam = 'search',
  value,
  onChange,
  placeholder = '搜索并选择',
  allowClear = true,
  disabled = false,
  mode,
  style,
  labelFor,
  excludeIds = [],
}: {
  id?: string;
  endpoint: string;
  params?: Record<string, unknown>;
  labelField?: string;
  searchParam?: string;
  value?: any;
  onChange?: (value: any, option?: any, record?: any) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  mode?: 'multiple' | 'tags';
  style?: CSSProperties;
  labelFor?: (record: any) => string;
  excludeIds?: string[];
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const paramsKey = queryString(params);
  const records = useRef(new Map<string, any>());
  const query = useData(
    `${endpoint}${endpoint.includes('?') ? '&' : '?'}${queryString({ ...params, [searchParam]: search, page, pageSize: 20 })}`,
    !disabled,
  );
  useEffect(() => {
    setPage(1);
    setSearch('');
    records.current.clear();
  }, [endpoint, paramsKey]);
  const incoming: any[] = query.data?.items || [];
  for (const record of incoming) records.current.set(record.id, record);
  const selectedIds: string[] = Array.isArray(value) ? value : value ? [value] : [];
  const choices = new Map(incoming.map((record) => [record.id, record]));
  for (const id of selectedIds) {
    const record = records.current.get(id);
    if (record) choices.set(id, record);
  }
  return (
    <Select
      id={id}
      showSearch
      filterOption={false}
      allowClear={allowClear}
      disabled={disabled}
      mode={mode}
      value={value}
      placeholder={placeholder}
      loading={query.isFetching}
      style={style || { width: '100%' }}
      onSearch={(text) => {
        setSearch(text);
        setPage(1);
      }}
      onChange={(next, option) =>
        onChange?.(next, option, incoming.find((record) => record.id === next) || records.current.get(next))
      }
      options={[...choices.values()]
        .filter((record) => !excludeIds.includes(record.id))
        .map((record) => ({
          value: record.id,
          label: labelFor ? labelFor(record) : record[labelField] || record.id,
        }))}
      notFoundContent={
        query.isError ? '加载失败，请重新搜索' : query.isFetching ? '正在加载…' : '没有匹配结果'
      }
      popupRender={(menu) => (
        <>
          {menu}
          <div
            style={{ borderTop: '1px solid #edf0f3', padding: '10px 8px' }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Pagination
              simple
              current={page}
              total={query.data?.total || 0}
              pageSize={20}
              onChange={setPage}
              showSizeChanger={false}
              hideOnSinglePage
            />
          </div>
        </>
      )}
    />
  );
}
