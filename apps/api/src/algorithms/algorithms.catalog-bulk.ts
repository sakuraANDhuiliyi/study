import { bulkAlgorithmLimitCases } from './algorithms.catalog-bulk-limits';
import type { AlgorithmContent } from './algorithms.catalog';
import { bulkAlgorithmDefinitions } from './algorithms.catalog-bulk-data';

const references = {
  数学: { title: 'cp-algorithms：数学算法主题', url: 'https://cp-algorithms.com/' },
  数组: { title: 'CSES：排序与搜索主题目录', url: 'https://cses.fi/problemset/' },
  字符串: { title: 'cp-algorithms：字符串算法主题', url: 'https://cp-algorithms.com/' },
  动态规划: { title: 'AtCoder：Educational DP 主题目录', url: 'https://atcoder.jp/contests/dp/tasks' },
  图: { title: 'cp-algorithms：图算法主题', url: 'https://cp-algorithms.com/' },
  树: { title: 'CSES：树算法主题目录', url: 'https://cses.fi/problemset/' },
  几何: { title: 'cp-algorithms：计算几何主题', url: 'https://cp-algorithms.com/' },
  数据结构: { title: 'TheAlgorithms：数据结构主题目录', url: 'https://github.com/TheAlgorithms/JavaScript' },
};

/** Topic references guide this original content; statements/code/cases are not copied from upstream. */
export const bulkAlgorithmContents: AlgorithmContent[] = bulkAlgorithmDefinitions.map((item) => {
  const source = references[item.tags[0] as keyof typeof references] ?? references.数组;
  return {
    id: item.id,
    title: item.title,
    difficulty: item.difficulty,
    tags: [...item.tags],
    description: item.description,
    inputFormat: item.inputFormat,
    outputFormat: item.outputFormat,
    constraints: item.constraints,
    examples: item.examples.map((example) => ({ ...example })),
    hiddenCases: [
      ...item.hiddenCases.map(([input, output]): [string, string] => [input, output]),
      ...(bulkAlgorithmLimitCases[item.id] ?? []),
    ],
    hints: [...item.hints],
    solution: `${item.solution} 时间 ${item.timeComplexity}，辅助空间 ${item.spaceComplexity}。`,
    sourceReferences: [{ ...source, concept: item.tags.slice(1).join('、') || item.tags[0] }],
  };
});

export const bulkReferencePrograms: Record<string, string> = Object.fromEntries(
  bulkAlgorithmDefinitions.map((item) => [
    item.id,
    `// 本项目原创参考程序，采用标准输入输出；不执行网络、文件写入或子进程。\nconst fs = require('fs');\nconst raw = fs.readFileSync(0, 'utf8');\nconst tokens = raw.trim() ? raw.trim().split(/\\s+/) : [];\nlet cursor = 0;\nconst next = () => tokens[cursor++];\nconst num = () => Number(next());\nfunction solve() {\n${item.body}\n}\nconsole.log(String(solve()));\n`,
  ]),
);
