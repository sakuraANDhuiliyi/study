import { useState } from 'react';
import { Alert, App, Button, Checkbox, Popconfirm, Select, Tabs, Tag } from 'antd';
import { BookOpen, CheckCircle2, ChevronRight, Copy, Lightbulb, LockKeyhole, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '../../api';
import { QueryState } from '../shared';
import { languageOptions } from './types';
import type { Editorial as EditorialType, Language, ProblemCard } from './types';

export function Editorial({
  problemId,
  language,
  onLoadCode,
}: {
  problemId: string;
  language: Language;
  onLoadCode: (code: string, language: Language) => void;
}) {
  const query = useData<{ editorial: EditorialType; relatedProblems: ProblemCard[] }>(
    `/algorithms/problems/${problemId}/editorial`,
  );
  const [revealed, setRevealed] = useState(false);
  const [hints, setHints] = useState(0);
  const [codeLanguage, setCodeLanguage] = useState(language);
  const { message } = App.useApp();
  const editorial = query.data?.editorial;
  const availableLanguages = languageOptions.filter((option) =>
    Boolean(editorial?.referenceCode[option.value]),
  );
  const selectedLanguage = editorial?.referenceCode[codeLanguage]
    ? codeLanguage
    : editorial?.referenceCode.javascript
      ? 'javascript'
      : availableLanguages[0]?.value;
  const referenceCode = selectedLanguage ? editorial?.referenceCode[selectedLanguage] || '' : '';
  return (
    <div className="algo-editorial">
      <QueryState query={query}>
        {editorial && (
          <>
            <div className="algo-editorial-intro">
              <Tag color="blue">学习题解</Tag>
              <p>{editorial.introduction}</p>
            </div>
            <section>
              <h3>
                <BookOpen size={16} />
                开始之前
              </h3>
              <p className="algo-muted">先确认这些基础概念，再尝试用自己的话复述题目。</p>
              <div className="algo-tags">
                {editorial.prerequisites.map((item) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </div>
            </section>
            <section>
              <h3>审题清单</h3>
              <div className="algo-reading-checklist">
                {editorial.readingGuide.map((item, i) => (
                  <Checkbox key={i}>{item}</Checkbox>
                ))}
              </div>
            </section>
            <section className="algo-progressive-hints">
              <h3>
                <Lightbulb size={16} />
                循序提示
              </h3>
              <p className="algo-muted">每次只看一步，给自己留一点思考空间。</p>
              {editorial.hints.slice(0, hints).map((hint, index) => (
                <div className="algo-hint" key={index}>
                  <span>{index + 1}</span>
                  <p>{hint}</p>
                </div>
              ))}
              <Button
                icon={<Lightbulb size={14} />}
                disabled={hints >= editorial.hints.length}
                onClick={() => setHints(hints + 1)}
              >
                {hints === 0
                  ? '查看第 1 条提示'
                  : hints < editorial.hints.length
                    ? `展开第 ${hints + 1} 条提示`
                    : '已展开全部提示'}
              </Button>
            </section>
            {!revealed ? (
              <div className="algo-editorial-unlock">
                <LockKeyhole size={26} />
                <h3>准备好核对你的思路了吗？</h3>
                <p>完整题解包含解法、正确性说明、复杂度推导和已提供语言的参考程序。</p>
                <Button type="primary" onClick={() => setRevealed(true)}>
                  显示完整题解与答案
                </Button>
              </div>
            ) : (
              <>
                <section>
                  <h3>解法比较</h3>
                  <div className="algo-table-scroll">
                    <table className="algo-learning-table">
                      <thead>
                        <tr>
                          <th>方法</th>
                          <th>时间</th>
                          <th>空间</th>
                          <th>如何选择</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editorial.approaches.map((approach) => (
                          <tr key={approach.name}>
                            <th>{approach.name}</th>
                            <td>{approach.timeComplexity}</td>
                            <td>{approach.spaceComplexity}</td>
                            <td>{approach.tradeoff}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Tabs
                    className="algo-approach-tabs"
                    items={editorial.approaches.map((approach, i) => ({
                      key: String(i),
                      label: `${i + 1}. ${approach.name}`,
                      children: (
                        <div className="algo-approach-content">
                          <h4>核心观察</h4>
                          <p>{approach.intuition}</p>
                          <h4>从思路到实现</h4>
                          <ol>
                            {approach.steps.map((step, index) => (
                              <li key={index}>{step}</li>
                            ))}
                          </ol>
                          <h4>为什么它是正确的</h4>
                          <p>{approach.correctness}</p>
                          <div className="algo-complexity">
                            <div>
                              <span>时间复杂度</span>
                              <strong>{approach.timeComplexity}</strong>
                            </div>
                            <div>
                              <span>额外空间</span>
                              <strong>{approach.spaceComplexity}</strong>
                            </div>
                          </div>
                          <p className="algo-muted">{approach.tradeoff}</p>
                        </div>
                      ),
                    }))}
                  />
                </section>
                <section>
                  <h3>
                    <Play size={16} />
                    跟着样例走一遍
                  </h3>
                  <p className="algo-muted">输入</p>
                  <pre className="algo-code-block">{editorial.walkthrough.input}</pre>
                  <div className="algo-table-scroll">
                    <table className="algo-learning-table">
                      <thead>
                        <tr>
                          <th>步骤</th>
                          <th>当前状态</th>
                          <th>发生了什么</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editorial.walkthrough.steps.map((step) => (
                          <tr key={step.step}>
                            <td>{step.step}</td>
                            <td>
                              <code>{step.state}</code>
                            </td>
                            <td>{step.explanation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="algo-walkthrough-result">
                    <CheckCircle2 size={15} />
                    最终结果：<code>{editorial.walkthrough.result}</code>
                  </p>
                </section>
                <section>
                  <h3>边界用例</h3>
                  <div className="algo-table-scroll">
                    <table className="algo-learning-table">
                      <thead>
                        <tr>
                          <th>需要测试的情况</th>
                          <th>为什么要测</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editorial.edgeCases.map((item, i) => (
                          <tr key={i}>
                            <th>{item.case}</th>
                            <td>{item.why}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section>
                  <h3>常见错误与排查</h3>
                  {editorial.mistakes.map((item, i) => (
                    <div className="algo-mistake-note" key={i}>
                      <strong>{item.mistake}</strong>
                      <p>{item.fix}</p>
                    </div>
                  ))}
                </section>
                <section>
                  <div className="algo-reference-heading">
                    <h3>参考代码</h3>
                    <Select
                      size="small"
                      aria-label="参考代码语言"
                      value={selectedLanguage}
                      onChange={setCodeLanguage}
                      options={availableLanguages}
                    />
                  </div>
                  <p className="algo-muted">完整的标准输入 / 输出程序。先理解每一步，再尝试独立重写。</p>
                  {!editorial.referenceCode[language] && (
                    <Alert
                      type="info"
                      showIcon
                      message="本题暂未提供当前作答语言的参考程序，已显示可用的参考语言。题目仍支持四种语言作答。"
                    />
                  )}
                  <pre className="algo-code-block algo-reference-code">{referenceCode}</pre>
                  <div className="algo-reference-actions">
                    <Button
                      icon={<Copy size={14} />}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(referenceCode);
                          message.success('参考代码已复制');
                        } catch {
                          message.error('浏览器不允许访问剪贴板，请在代码框中选择复制。');
                        }
                      }}
                    >
                      复制参考代码
                    </Button>
                    <Popconfirm
                      title="载入参考代码并替换当前编辑器内容？"
                      description="当前代码会被覆盖。建议先保存需要保留的解法。"
                      okText="载入参考代码"
                      cancelText="取消"
                      onConfirm={() => {
                        if (!selectedLanguage || !referenceCode) return;
                        onLoadCode(referenceCode, selectedLanguage);
                        message.success('参考代码已载入编辑器');
                      }}
                    >
                      <Button>载入编辑器</Button>
                    </Popconfirm>
                  </div>
                </section>
                {!!editorial.followUp.length && (
                  <section>
                    <h3>再想深一步</h3>
                    <ol>
                      {editorial.followUp.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
            {!!query.data?.relatedProblems.length && (
              <section>
                <h3>关联练习</h3>
                <div className="algo-related-problems">
                  {query.data.relatedProblems.map((problem) => (
                    <Link key={problem.id} to={`/algorithms/${problem.id}`}>
                      <span>
                        {String(problem.number).padStart(3, '0')} · {problem.title}
                      </span>
                      {problem.status === 'solved' ? <CheckCircle2 size={16} /> : <ChevronRight size={16} />}
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
