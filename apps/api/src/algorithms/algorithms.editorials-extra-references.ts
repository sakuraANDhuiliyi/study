import type { AlgorithmEditorialLanguage } from './algorithms.editorials.types';

const cpp = (body: string) =>
  `#include <iostream>\n#include <vector>\n#include <queue>\n#include <algorithm>\n#include <numeric>\n#include <limits>\n#include <string>\n#include <utility>\n#include <functional>\nusing namespace std;\nint main() {\n    ios::sync_with_stdio(false); cin.tie(nullptr);\n${body}\n}\n`;
const java = (body: string, helpers = '') =>
  `import java.io.*;\nimport java.util.*;\npublic class Main {\n    static class FastScanner {\n        private final InputStream in = System.in;\n        private final byte[] buffer = new byte[1 << 16];\n        private int ptr = 0, len = 0;\n        int read() throws IOException {\n            if (ptr >= len) { len = in.read(buffer); ptr = 0; if (len <= 0) return -1; }\n            return buffer[ptr++];\n        }\n        String next() throws IOException {\n            StringBuilder s = new StringBuilder(); int c;\n            do { c = read(); } while (c <= 32 && c != -1);\n            while (c > 32) { s.append((char)c); c = read(); }\n            return s.toString();\n        }\n        int nextInt() throws IOException {\n            int c; do { c = read(); } while (c <= 32 && c != -1);\n            int sign = 1; if (c == '-') { sign = -1; c = read(); }\n            int x = 0; while (c > 32) { x = x * 10 + c - '0'; c = read(); }\n            return x * sign;\n        }\n    }\n${helpers}\n    public static void main(String[] args) throws Exception {\n        FastScanner in = new FastScanner();\n${body}\n    }\n}\n`;
const js = (body: string) =>
  `const fs = require('fs');\nconst tokens = fs.readFileSync(0, 'utf8').trim().split(/\\s+/);\nlet p = 0;\nconst next = () => Number(tokens[p++]);\n${body}\n`;

export const extraReferenceCode: Record<string, Record<AlgorithmEditorialLanguage, string>> = {
  'range-sum': {
    cpp: cpp(`    int n, q; cin >> n >> q;
    vector<long long> prefix(n + 1, 0);
    for (int i = 1; i <= n; ++i) { long long x; cin >> x; prefix[i] = prefix[i - 1] + x; }
    while (q--) { int l, r; cin >> l >> r; cout << prefix[r] - prefix[l - 1] << '\\n'; }`),
    python: `import sys

def solve():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, q = data[:2]
    prefix = [0] * (n + 1)
    for i in range(1, n + 1):
        prefix[i] = prefix[i - 1] + data[i + 1]
    answers = []
    pos = n + 2
    for _ in range(q):
        left, right = data[pos], data[pos + 1]
        pos += 2
        answers.append(str(prefix[right] - prefix[left - 1]))
    sys.stdout.write('\\n'.join(answers))

if __name__ == '__main__':
    solve()
`,
    javascript: js(`const n = next(), q = next();
const prefix = new Array(n + 1).fill(0);
for (let i = 1; i <= n; i++) prefix[i] = prefix[i - 1] + next();
const answer = [];
for (let i = 0; i < q; i++) {
  const left = next(), right = next();
  answer.push(String(prefix[right] - prefix[left - 1]));
}
// 题目最大绝对和为 10^14，小于 Number 的安全整数上限。
process.stdout.write(answer.join('\\n'));`),
    java: java(`        int n = in.nextInt(), q = in.nextInt();
        long[] prefix = new long[n + 1];
        for (int i = 1; i <= n; i++) prefix[i] = prefix[i - 1] + in.nextInt();
        StringBuilder out = new StringBuilder();
        while (q-- > 0) { int l = in.nextInt(), r = in.nextInt(); out.append(prefix[r] - prefix[l - 1]).append('\\n'); }
        System.out.print(out);`),
  },
  'merge-intervals': {
    cpp: cpp(`    int n; cin >> n;
    vector<pair<int, int>> intervals(n), answer;
    for (auto &interval : intervals) cin >> interval.first >> interval.second;
    sort(intervals.begin(), intervals.end());
    for (auto [l, r] : intervals) {
        if (answer.empty() || l > answer.back().second) answer.push_back({l, r});
        else answer.back().second = max(answer.back().second, r);
    }
    cout << answer.size() << '\\n';
    for (auto [l, r] : answer) cout << l << ' ' << r << '\\n';`),
    python: `import sys

def solve():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n = data[0]
    intervals = sorted((data[2*i+1], data[2*i+2]) for i in range(n))
    answer = []
    for left, right in intervals:
        if not answer or left > answer[-1][1]:
            answer.append([left, right])
        else:
            answer[-1][1] = max(answer[-1][1], right)
    print(len(answer))
    sys.stdout.write('\\n'.join(f'{left} {right}' for left, right in answer))

if __name__ == '__main__':
    solve()
`,
    javascript: js(`const n = next();
const intervals = Array.from({length: n}, () => [next(), next()]);
intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const answer = [];
for (const [left, right] of intervals) {
  const last = answer[answer.length - 1];
  if (!last || left > last[1]) answer.push([left, right]);
  else last[1] = Math.max(last[1], right);
}
console.log([String(answer.length), ...answer.map(x => x.join(' '))].join('\\n'));`),
    java: java(`        int n = in.nextInt();
        int[][] intervals = new int[n][2];
        for (int i = 0; i < n; i++) { intervals[i][0] = in.nextInt(); intervals[i][1] = in.nextInt(); }
        Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));
        List<int[]> answer = new ArrayList<>();
        for (int[] interval : intervals) {
            if (answer.isEmpty() || interval[0] > answer.get(answer.size() - 1)[1]) answer.add(interval.clone());
            else { int[] last = answer.get(answer.size() - 1); last[1] = Math.max(last[1], interval[1]); }
        }
        StringBuilder out = new StringBuilder().append(answer.size()).append('\\n');
        for (int[] interval : answer) out.append(interval[0]).append(' ').append(interval[1]).append('\\n');
        System.out.print(out);`),
  },
  'binary-tree-depth': {
    cpp: cpp(`    int n; cin >> n;
    vector<int> left(n + 1), right(n + 1);
    for (int i = 1; i <= n; i++) cin >> left[i] >> right[i];
    if (!n) { cout << 0 << '\\n'; return 0; }
    queue<int> q; q.push(1); int depth = 0;
    while (!q.empty()) {
        int levelSize = (int)q.size(); ++depth;
        while (levelSize--) {
            int u = q.front(); q.pop();
            if (left[u]) q.push(left[u]);
            if (right[u]) q.push(right[u]);
        }
    }
    cout << depth << '\\n';`),
    python: `import sys
from collections import deque

def solve():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n = data[0]
    if n == 0:
        print(0)
        return
    children = [(0, 0)] + [(data[2*i-1], data[2*i]) for i in range(1, n + 1)]
    queue = deque([1])
    depth = 0
    while queue:
        depth += 1
        # 固定本层大小，新增的孩子留给下一层处理。
        for _ in range(len(queue)):
            u = queue.popleft()
            for child in children[u]:
                if child:
                    queue.append(child)
    print(depth)

if __name__ == '__main__':
    solve()
`,
    javascript: js(`const n = next();
const left = new Int32Array(n + 1), right = new Int32Array(n + 1);
for (let i = 1; i <= n; i++) { left[i] = next(); right[i] = next(); }
const queue = n ? [1] : [];
let head = 0, depth = 0;
while (head < queue.length) {
  const levelEnd = queue.length;
  depth++;
  while (head < levelEnd) {
    const u = queue[head++];
    if (left[u]) queue.push(left[u]);
    if (right[u]) queue.push(right[u]);
  }
}
// 用队首下标代替 shift()，避免搬移数组。
console.log(depth);`),
    java: java(`        int n = in.nextInt();
        int[] left = new int[n + 1], right = new int[n + 1];
        for (int i = 1; i <= n; i++) { left[i] = in.nextInt(); right[i] = in.nextInt(); }
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        if (n > 0) queue.add(1);
        int depth = 0;
        while (!queue.isEmpty()) {
            int levelSize = queue.size(); depth++;
            while (levelSize-- > 0) {
                int u = queue.remove();
                if (left[u] != 0) queue.add(left[u]);
                if (right[u] != 0) queue.add(right[u]);
            }
        }
        System.out.println(depth);`),
  },
  'island-count': {
    cpp: cpp(`    int rows, cols; cin >> rows >> cols;
    vector<string> grid(rows); for (auto &row : grid) cin >> row;
    const int dr[] = {-1, 1, 0, 0}, dc[] = {0, 0, -1, 1};
    int islands = 0;
    for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
        if (grid[r][c] != '1') continue;
        ++islands; queue<pair<int, int>> q; q.push({r, c}); grid[r][c] = '0';
        while (!q.empty()) {
            auto [x, y] = q.front(); q.pop();
            for (int k = 0; k < 4; k++) {
                int nx = x + dr[k], ny = y + dc[k];
                if (nx >= 0 && nx < rows && ny >= 0 && ny < cols && grid[nx][ny] == '1') {
                    grid[nx][ny] = '0'; q.push({nx, ny});
                }
            }
        }
    }
    cout << islands << '\\n';`),
    python: `import sys
from collections import deque

def solve():
    data = sys.stdin.buffer.read().split()
    rows, cols = int(data[0]), int(data[1])
    grid = [bytearray(row) for row in data[2:]]
    islands = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != 49:
                continue
            islands += 1
            grid[r][c] = 48
            queue = deque([(r, c)])
            while queue:
                x, y = queue.popleft()
                for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                    if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == 49:
                        grid[nx][ny] = 48  # 入队即标记，避免重复入队。
                        queue.append((nx, ny))
    print(islands)

if __name__ == '__main__':
    solve()
`,
    javascript: js(`const rows = next(), cols = next();
const grid = Array.from({length: rows}, () => tokens[p++].split(''));
const dr = [-1, 1, 0, 0], dc = [0, 0, -1, 1];
let islands = 0;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  if (grid[r][c] !== '1') continue;
  islands++;
  const queue = [r * cols + c];
  grid[r][c] = '0';
  for (let head = 0; head < queue.length; head++) {
    const x = Math.floor(queue[head] / cols), y = queue[head] % cols;
    for (let k = 0; k < 4; k++) {
      const nx = x + dr[k], ny = y + dc[k];
      if (nx >= 0 && nx < rows && ny >= 0 && ny < cols && grid[nx][ny] === '1') {
        grid[nx][ny] = '0';
        queue.push(nx * cols + ny);
      }
    }
  }
}
console.log(islands);`),
    java: java(`        int rows = in.nextInt(), cols = in.nextInt();
        char[][] grid = new char[rows][];
        for (int r = 0; r < rows; r++) grid[r] = in.next().toCharArray();
        int[] dr = {-1, 1, 0, 0}, dc = {0, 0, -1, 1};
        int islands = 0;
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
            if (grid[r][c] != '1') continue;
            islands++; grid[r][c] = '0'; queue.add(r * cols + c);
            while (!queue.isEmpty()) {
                int pos = queue.remove(), x = pos / cols, y = pos % cols;
                for (int k = 0; k < 4; k++) {
                    int nx = x + dr[k], ny = y + dc[k];
                    if (nx >= 0 && nx < rows && ny >= 0 && ny < cols && grid[nx][ny] == '1') {
                        grid[nx][ny] = '0'; queue.add(nx * cols + ny);
                    }
                }
            }
        }
        System.out.println(islands);`),
  },
  'shortest-path': {
    cpp: cpp(`    int n, m, s, t; cin >> n >> m >> s >> t;
    vector<vector<pair<int, long long>>> graph(n + 1);
    while (m--) { int u, v; long long w; cin >> u >> v >> w; graph[u].push_back({v, w}); }
    const long long INF = numeric_limits<long long>::max() / 4;
    vector<long long> dist(n + 1, INF);
    using State = pair<long long, int>;
    priority_queue<State, vector<State>, greater<State>> heap;
    dist[s] = 0; heap.push({0, s});
    while (!heap.empty()) {
        auto [d, u] = heap.top(); heap.pop();
        if (d != dist[u]) continue; // 跳过旧距离对应的堆条目。
        if (u == t) break;
        for (auto [v, w] : graph[u]) if (d + w < dist[v]) {
            dist[v] = d + w; heap.push({dist[v], v});
        }
    }
    cout << (dist[t] == INF ? -1 : dist[t]) << '\\n';`),
    python: `import sys
import heapq

def solve():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, m, source, target = data[:4]
    graph = [[] for _ in range(n + 1)]
    for i in range(m):
        u, v, weight = data[4+3*i:7+3*i]
        graph[u].append((v, weight))
    dist = [float('inf')] * (n + 1)
    dist[source] = 0
    heap = [(0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if d != dist[u]:
            continue
        if u == target:
            break
        for v, weight in graph[u]:
            candidate = d + weight
            if candidate < dist[v]:
                dist[v] = candidate
                heapq.heappush(heap, (candidate, v))
    print(-1 if dist[target] == float('inf') else dist[target])

if __name__ == '__main__':
    solve()
`,
    javascript: js(`// 最小堆保存 [距离, 结点]，仅按距离排序。
class MinHeap {
  constructor() { this.a = []; }
  push(value) {
    const a = this.a; let i = a.length; a.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= value[0]) break;
      a[i] = a[parent]; i = parent;
    }
    a[i] = value;
  }
  pop() {
    const a = this.a, answer = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1][0] < a[child][0]) child++;
        if (a[child][0] >= last[0]) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return answer;
  }
}
const n = next(), m = next(), source = next(), target = next();
const graph = Array.from({length: n + 1}, () => []);
for (let i = 0; i < m; i++) { const u = next(), v = next(), w = next(); graph[u].push([v, w]); }
const dist = new Array(n + 1).fill(Infinity);
const heap = new MinHeap(); dist[source] = 0; heap.push([0, source]);
while (heap.a.length) {
  const [d, u] = heap.pop();
  if (d !== dist[u]) continue;
  if (u === target) break;
  for (const [v, w] of graph[u]) if (d + w < dist[v]) {
    dist[v] = d + w; heap.push([dist[v], v]);
  }
}
console.log(dist[target] === Infinity ? -1 : dist[target]);`),
    java: java(
      `        int n = in.nextInt(), m = in.nextInt(), source = in.nextInt(), target = in.nextInt();
        List<List<Edge>> graph = new ArrayList<>();
        for (int i = 0; i <= n; i++) graph.add(new ArrayList<>());
        while (m-- > 0) { int u = in.nextInt(), v = in.nextInt(); long w = in.nextInt(); graph.get(u).add(new Edge(v, w)); }
        long inf = Long.MAX_VALUE / 4;
        long[] dist = new long[n + 1]; Arrays.fill(dist, inf); dist[source] = 0;
        PriorityQueue<long[]> heap = new PriorityQueue<>(Comparator.comparingLong(a -> a[0]));
        heap.add(new long[]{0, source});
        while (!heap.isEmpty()) {
            long[] state = heap.remove(); long d = state[0]; int u = (int)state[1];
            if (d != dist[u]) continue;
            if (u == target) break;
            for (Edge edge : graph.get(u)) if (d + edge.w < dist[edge.v]) {
                dist[edge.v] = d + edge.w; heap.add(new long[]{dist[edge.v], edge.v});
            }
        }
        System.out.println(dist[target] == inf ? -1 : dist[target]);`,
      `    static class Edge {
        int v; long w;
        Edge(int v, long w) { this.v = v; this.w = w; }
    }`,
    ),
  },
  'connected-components': {
    cpp: cpp(`    int n, m; cin >> n >> m;
    vector<int> parent(n + 1), size(n + 1, 1); iota(parent.begin(), parent.end(), 0);
    auto find = [&](int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    int components = n;
    while (m--) {
        int u, v; cin >> u >> v; int a = find(u), b = find(v);
        if (a == b) continue;
        if (size[a] < size[b]) swap(a, b);
        parent[b] = a; size[a] += size[b]; --components;
    }
    cout << components << '\\n';`),
    python: `import sys

def solve():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, m = data[:2]
    parent = list(range(n + 1))
    size = [1] * (n + 1)
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    components = n
    for i in range(m):
        a, b = find(data[2+2*i]), find(data[3+2*i])
        if a == b:
            continue
        if size[a] < size[b]:
            a, b = b, a
        parent[b] = a
        size[a] += size[b]
        components -= 1
    print(components)

if __name__ == '__main__':
    solve()
`,
    javascript: js(`const n = next(), m = next();
const parent = Array.from({length: n + 1}, (_, i) => i);
const size = new Int32Array(n + 1).fill(1);
function find(x) {
  while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
  return x;
}
let components = n;
for (let i = 0; i < m; i++) {
  let a = find(next()), b = find(next());
  if (a === b) continue;
  if (size[a] < size[b]) [a, b] = [b, a];
  parent[b] = a; size[a] += size[b]; components--;
}
console.log(components);`),
    java: java(
      `        int n = in.nextInt(), m = in.nextInt();
        parent = new int[n + 1]; size = new int[n + 1];
        for (int i = 1; i <= n; i++) { parent[i] = i; size[i] = 1; }
        int components = n;
        while (m-- > 0) {
            int a = find(in.nextInt()), b = find(in.nextInt());
            if (a == b) continue;
            if (size[a] < size[b]) { int temp = a; a = b; b = temp; }
            parent[b] = a; size[a] += size[b]; components--;
        }
        System.out.println(components);`,
      `    static int[] parent, size;
    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }`,
    ),
  },
};
