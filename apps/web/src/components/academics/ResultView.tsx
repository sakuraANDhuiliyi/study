import { Alert } from 'antd';
import { Chart } from '../shared';
import type { LearningResult } from './types';
import { CategoryChart } from './CategoryChart';

export function ResultView({ result }: { result: LearningResult }) {
  return (
    <div className="academic-result">
      <div className="academic-result-summary">
        <span>本次学习结果</span>
        <h3>{result.summary}</h3>
      </div>
      {!!result.metrics?.length && (
        <div className="academic-metrics">
          {result.metrics.map((metric, index) => (
            <div key={index}>
              <span>{metric.label}</span>
              <strong>
                {String(metric.value)} <small>{metric.unit}</small>
              </strong>
            </div>
          ))}
        </div>
      )}
      {result.sections?.map((section, index) => (
        <Alert
          key={index}
          showIcon
          type={section.status || 'info'}
          message={section.title}
          description={<span className="academic-preserve">{section.content}</span>}
        />
      ))}
      {result.tables?.map((table, index) => (
        <section key={index}>
          <h3>{table.title}</h3>
          <div
            className="academic-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={`${table.title}，可横向滚动`}
          >
            <table>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.key}>{column.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {table.columns.map((column) => (
                      <td key={column.key}>{row[column.key] == null ? '—' : String(row[column.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {result.categoryChart !== undefined && <CategoryChart value={result.categoryChart} />}
      {result.chart && (
        <section>
          <h3>{result.chart.title}</h3>
          <Chart
            height={280}
            option={{
              tooltip: { trigger: 'axis' },
              grid: { left: 60, right: 25, bottom: 45, top: 20 },
              xAxis: { type: 'value' },
              yAxis: { type: 'value' },
              series: [
                {
                  type: 'line',
                  data: result.chart.points.map((point) => [point.x, point.y]),
                  smooth: false,
                  showSymbol: true,
                  lineStyle: { color: '#206bc4' },
                  itemStyle: { color: '#206bc4' },
                },
              ],
            }}
          />
        </section>
      )}
    </div>
  );
}
