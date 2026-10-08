import { Alert } from 'antd';
import { Chart } from '../shared';
import type { LearningResult } from './types';

type CategoryChartData = NonNullable<LearningResult['categoryChart']>;

function validChart(value: unknown): value is CategoryChartData {
  if (!value || typeof value !== 'object') return false;
  const chart = value as Partial<CategoryChartData>;
  const label = (item: unknown): item is string => typeof item === 'string' && !!item.trim();
  return (
    label(chart.title) &&
    (chart.yAxisLabel === undefined || label(chart.yAxisLabel)) &&
    Array.isArray(chart.categories) &&
    chart.categories.length > 0 &&
    chart.categories.every(label) &&
    new Set(chart.categories).size === chart.categories.length &&
    Array.isArray(chart.series) &&
    chart.series.length > 0 &&
    chart.series.every(
      (series) =>
        series &&
        typeof series === 'object' &&
        label(series.name) &&
        Array.isArray(series.values) &&
        series.values.length === chart.categories!.length &&
        series.values.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0),
    ) &&
    new Set(chart.series.map((series) => series.name)).size === chart.series.length
  );
}

export function CategoryChart({ value }: { value: unknown }) {
  if (!validChart(value))
    return (
      <Alert
        type="warning"
        showIcon
        message="分类图表无法绘制"
        description="已保存的图表数据不完整或格式不正确，请查看结果表格中的完整数据。"
      />
    );
  return (
    <section className="academic-category-chart">
      <h3>{value.title}</h3>
      <Chart
        height={320}
        label={`${value.title}，分组柱状图；类别：${value.categories.join('、')}；系列：${value.series.map((series) => series.name).join('、')}${value.yAxisLabel ? `；纵轴：${value.yAxisLabel}` : ''}`}
        option={{
          animation: false,
          color: ['#206bc4', '#c27b13', '#50865b', '#8266b4'],
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            confine: true,
            className: 'academic-category-tooltip',
            valueFormatter: (item) => String(item),
          },
          legend: { type: 'scroll', top: 0, left: 'center', textStyle: { fontSize: 12 } },
          grid: { containLabel: true, left: 10, right: 16, bottom: 16, top: 66 },
          xAxis: {
            type: 'category',
            data: value.categories,
            axisTick: { alignWithLabel: true },
            axisLabel: { interval: 0 },
          },
          yAxis: { type: 'value', min: 0, name: value.yAxisLabel, nameGap: 20 },
          series: value.series.map((series) => ({
            name: series.name,
            type: 'bar',
            data: series.values,
            barMaxWidth: 48,
            barGap: '20%',
            emphasis: { focus: 'series' },
          })),
        }}
      />
      <p className="academic-category-caption">
        同一类别内并排比较各组数据；图中保留零值与小数，完整数值见结果表格。
      </p>
    </section>
  );
}
