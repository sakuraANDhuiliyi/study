import { Alert } from 'antd';
export const normalizeOutput = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
export function OutputDiff({
  expected,
  actual,
  selfTest = false,
}: {
  expected: string;
  actual: string;
  selfTest?: boolean;
}) {
  const expectedLines = normalizeOutput(expected).split('\n');
  const actualLines = normalizeOutput(actual).split('\n');
  const equal = normalizeOutput(expected) === normalizeOutput(actual);
  const rows = Math.max(expectedLines.length, actualLines.length);
  const show = (value: string | undefined) =>
    value === undefined
      ? '∅（缺少此行）'
      : value === ''
        ? '（空行）'
        : value.replace(/\t/g, '⇥').replace(/ /g, '·');
  return (
    <div className="algo-output-diff">
      <Alert
        showIcon
        type={equal ? 'success' : 'warning'}
        message={`${selfTest ? '自测比较' : '输出比较'}：${equal ? '输出一致' : '存在差异'}`}
        description={
          selfTest
            ? '仅在浏览器中与自填预期输出比较，不影响评测结果或题目完成状态。忽略末尾空白，空格显示为 ·，制表符显示为 ⇥。'
            : '逐行对照，忽略末尾空白。空格显示为 ·，制表符显示为 ⇥；高亮行为差异行。'
        }
      />
      <div className="algo-table-scroll">
        <table className="algo-diff-table">
          <thead>
            <tr>
              <th>行</th>
              <th>预期输出</th>
              <th>实际输出</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(rows, 100) }, (_, index) => (
              <tr key={index} className={expectedLines[index] === actualLines[index] ? '' : 'is-different'}>
                <td>{index + 1}</td>
                <td>
                  <code>{show(expectedLines[index])}</code>
                </td>
                <td>
                  <code>{show(actualLines[index])}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows > 100 && <p className="algo-muted">仅展示前 100 行差异，请在完整输出中查看剩余内容。</p>}
    </div>
  );
}
