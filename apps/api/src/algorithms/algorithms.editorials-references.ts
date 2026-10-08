import type { AlgorithmEditorialLanguage } from './algorithms.editorials.types';

type Programs = Record<AlgorithmEditorialLanguage, string>;
const cpp = (body: string, helpers = '') => `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
#include <queue>
#include <limits>
using namespace std;
${helpers}
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
${body.trimEnd()}
    return 0;
}
`;
const python = (body: string) => `import sys\n\n${body.trim()}\n`;
const javascript = (body: string) => String.raw`const fs = require('fs');
const raw = fs.readFileSync(0, 'utf8').trim();
const tokens = raw ? raw.split(/\s+/) : [];
${body.trim()}
`;
const java = (body: string, helpers = '') => String.raw`import java.io.*;
import java.util.*;

public class Main {
    // Buffered token reader avoids Scanner's overhead on large inputs.
    static class FastScanner {
        private final InputStream in = System.in;
        private final byte[] buffer = new byte[1 << 16];
        private int pos = 0, size = 0;
        private int read() throws IOException {
            if (pos >= size) {
                size = in.read(buffer);
                pos = 0;
                if (size < 0) return -1;
            }
            return buffer[pos++];
        }
        String next() throws IOException {
            int c;
            do { c = read(); } while (c <= 32 && c != -1);
            StringBuilder s = new StringBuilder();
            while (c > 32) { s.append((char)c); c = read(); }
            return s.toString();
        }
        long nextLong() throws IOException { return Long.parseLong(next()); }
        int nextInt() throws IOException { return (int)nextLong(); }
    }
${helpers}
    public static void main(String[] args) throws Exception {
        FastScanner in = new FastScanner();
${body.trimEnd()}
    }
}
`;

/** Trusted, repository-owned programs only. Never replace these with student input in local verification. */
export const coreReferencePrograms: Record<string, Programs> = {
  'sum-of-two': {
    cpp: cpp(String.raw`    long long a, b;
    cin >> a >> b;
    cout << a + b << '\n';`),
    python: python(`a, b = map(int, sys.stdin.buffer.read().split())\nprint(a + b)`),
    javascript: javascript(`const a = Number(tokens[0]), b = Number(tokens[1]);\nconsole.log(a + b);`),
    java: java(`        long a = in.nextLong(), b = in.nextLong();\n        System.out.println(a + b);`),
  },
  'array-maximum': {
    cpp: cpp(String.raw`    int n; cin >> n;
    long long best = numeric_limits<long long>::lowest();
    int position = 0;
    for (int i = 1; i <= n; ++i) {
        long long value; cin >> value;
        if (value > best) { best = value; position = i; }
    }
    cout << best << ' ' << position << '\n';`),
    python: python(`data = list(map(int, sys.stdin.buffer.read().split()))
n = data[0]
best, position = data[1], 1
for i in range(2, n + 1):
    if data[i] > best:
        best, position = data[i], i
print(best, position)`),
    javascript: javascript(`const n = Number(tokens[0]);
let best = -Infinity, position = 0;
for (let i = 1; i <= n; i++) {
  const value = Number(tokens[i]);
  if (value > best) { best = value; position = i; }
}
console.log(best + ' ' + position);`),
    java: java(`        int n = in.nextInt(), position = 0;
        long best = Long.MIN_VALUE;
        for (int i = 1; i <= n; i++) {
            long value = in.nextLong();
            if (value > best) { best = value; position = i; }
        }
        System.out.println(best + " " + position);`),
  },
  'palindrome-word': {
    cpp: cpp(String.raw`    string s; cin >> s;
    bool ok = true;
    for (int left = 0, right = (int)s.size() - 1; left < right; ++left, --right) {
        if (s[left] != s[right]) { ok = false; break; }
    }
    cout << (ok ? "YES" : "NO") << '\n';`),
    python: python(`s = sys.stdin.buffer.read().strip()
left, right = 0, len(s) - 1
while left < right and s[left] == s[right]:
    left += 1
    right -= 1
print("YES" if left >= right else "NO")`),
    javascript: javascript(`const s = tokens[0];
let left = 0, right = s.length - 1;
while (left < right && s[left] === s[right]) { left++; right--; }
console.log(left >= right ? 'YES' : 'NO');`),
    java: java(`        String s = in.next();
        int left = 0, right = s.length() - 1;
        while (left < right && s.charAt(left) == s.charAt(right)) { left++; right--; }
        System.out.println(left >= right ? "YES" : "NO");`),
  },
  'two-sum-indices': {
    cpp: cpp(String.raw`    int n; long long target; cin >> n >> target;
    unordered_map<long long, int> seen;
    seen.reserve(n * 2);
    for (int i = 1; i <= n; ++i) {
        long long value; cin >> value;
        auto found = seen.find(target - value);
        if (found != seen.end()) {
            cout << found->second << ' ' << i << '\n';
            return 0;
        }
        seen.emplace(value, i);
    }`),
    python: python(`data = list(map(int, sys.stdin.buffer.read().split()))
n, target = data[0], data[1]
seen = {}
for i in range(n):
    value = data[i + 2]
    if target - value in seen:
        print(seen[target - value], i + 1)
        break
    if value not in seen:
        seen[value] = i + 1`),
    javascript: javascript(`const n = Number(tokens[0]), target = Number(tokens[1]);
const seen = new Map();
for (let i = 0; i < n; i++) {
  const value = Number(tokens[i + 2]);
  if (seen.has(target - value)) {
    console.log(seen.get(target - value) + ' ' + (i + 1));
    break;
  }
  if (!seen.has(value)) seen.set(value, i + 1);
}`),
    java: java(`        int n = in.nextInt();
        long target = in.nextLong();
        Map<Long, Integer> seen = new HashMap<>();
        for (int i = 1; i <= n; i++) {
            long value = in.nextLong();
            Integer previous = seen.get(target - value);
            if (previous != null) { System.out.println(previous + " " + i); return; }
            seen.putIfAbsent(value, i);
        }`),
  },
  'first-position': {
    cpp: cpp(String.raw`    int n, q; cin >> n >> q;
    vector<long long> a(n);
    for (auto &value : a) cin >> value;
    while (q--) {
        long long x; cin >> x;
        int left = 0, right = n;
        while (left < right) {
            int mid = left + (right - left) / 2;
            if (a[mid] < x) left = mid + 1;
            else right = mid;
        }
        cout << (left < n && a[left] == x ? left + 1 : -1) << '\n';
    }`),
    python: python(String.raw`from bisect import bisect_left
data = list(map(int, sys.stdin.buffer.read().split()))
n, q = data[0], data[1]
a = data[2:2 + n]
answers = []
for x in data[2 + n:2 + n + q]:
    position = bisect_left(a, x)
    answers.append(str(position + 1 if position < n and a[position] == x else -1))
sys.stdout.write("\n".join(answers) + "\n")`),
    javascript: javascript(String.raw`const n = Number(tokens[0]), q = Number(tokens[1]);
const a = tokens.slice(2, 2 + n).map(Number), answers = [];
for (let i = 0; i < q; i++) {
  const x = Number(tokens[2 + n + i]);
  let left = 0, right = n;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (a[mid] < x) left = mid + 1;
    else right = mid;
  }
  answers.push(left < n && a[left] === x ? left + 1 : -1);
}
console.log(answers.join('\n'));`),
    java: java(String.raw`        int n = in.nextInt(), q = in.nextInt();
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = in.nextLong();
        StringBuilder answer = new StringBuilder();
        while (q-- > 0) {
            long x = in.nextLong();
            int left = 0, right = n;
            while (left < right) {
                int mid = left + (right - left) / 2;
                if (a[mid] < x) left = mid + 1;
                else right = mid;
            }
            answer.append(left < n && a[left] == x ? left + 1 : -1).append('\n');
        }
        System.out.print(answer);`),
  },
  'balanced-brackets': {
    cpp: cpp(String.raw`    string s; cin >> s;
    vector<char> stack;
    bool ok = true;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') stack.push_back(c);
        else {
            char expected = c == ')' ? '(' : c == ']' ? '[' : '{';
            if (stack.empty() || stack.back() != expected) { ok = false; break; }
            stack.pop_back();
        }
    }
    cout << (ok && stack.empty() ? "YES" : "NO") << '\n';`),
    python: python(`s = sys.stdin.buffer.read().decode().strip()
stack = []
pairs = {')': '(', ']': '[', '}': '{'}
ok = True
for char in s:
    if char in '([{':
        stack.append(char)
    elif not stack or stack.pop() != pairs[char]:
        ok = False
        break
print('YES' if ok and not stack else 'NO')`),
    javascript: javascript(`const stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
let ok = true;
for (const char of tokens[0]) {
  if ('([{'.includes(char)) stack.push(char);
  else if (!stack.length || stack.pop() !== pairs[char]) { ok = false; break; }
}
console.log(ok && stack.length === 0 ? 'YES' : 'NO');`),
    java: java(`        String s = in.next();
        Deque<Character> stack = new ArrayDeque<>();
        boolean ok = true;
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') stack.push(c);
            else {
                char expected = c == ')' ? '(' : c == ']' ? '[' : '{';
                if (stack.isEmpty() || stack.pop() != expected) { ok = false; break; }
            }
        }
        System.out.println(ok && stack.isEmpty() ? "YES" : "NO");`),
  },
  'maximum-subarray': {
    cpp: cpp(String.raw`    int n; cin >> n;
    long long current; cin >> current;
    long long best = current;
    for (int i = 1; i < n; ++i) {
        long long value; cin >> value;
        current = max(value, current + value);
        best = max(best, current);
    }
    cout << best << '\n';`),
    python: python(`data = list(map(int, sys.stdin.buffer.read().split()))
n = data[0]
current = best = data[1]
for value in data[2:n + 1]:
    current = max(value, current + value)
    best = max(best, current)
print(best)`),
    javascript: javascript(`const n = Number(tokens[0]);
let current = Number(tokens[1]), best = current;
for (let i = 2; i <= n; i++) {
  const value = Number(tokens[i]);
  current = Math.max(value, current + value);
  best = Math.max(best, current);
}
// The largest absolute sum is 1e14, below Number.MAX_SAFE_INTEGER.
console.log(best);`),
    java: java(`        int n = in.nextInt();
        long current = in.nextLong(), best = current;
        for (int i = 1; i < n; i++) {
            long value = in.nextLong();
            current = Math.max(value, current + value);
            best = Math.max(best, current);
        }
        System.out.println(best);`),
  },
  'longest-unique-window': {
    cpp: cpp(String.raw`    string s; cin >> s;
    vector<int> last(26, -1);
    int left = 0, best = 0;
    for (int right = 0; right < (int)s.size(); ++right) {
        int c = s[right] - 'a';
        left = max(left, last[c] + 1);
        last[c] = right;
        best = max(best, right - left + 1);
    }
    cout << best << '\n';`),
    python: python(`s = sys.stdin.buffer.read().strip()
last = [-1] * 26
left = best = 0
for right, char in enumerate(s):
    c = char - ord('a')
    left = max(left, last[c] + 1)
    last[c] = right
    best = max(best, right - left + 1)
print(best)`),
    javascript: javascript(`const s = tokens[0], last = Array(26).fill(-1);
let left = 0, best = 0;
for (let right = 0; right < s.length; right++) {
  const c = s.charCodeAt(right) - 97;
  left = Math.max(left, last[c] + 1);
  last[c] = right;
  best = Math.max(best, right - left + 1);
}
console.log(best);`),
    java: java(`        String s = in.next();
        int[] last = new int[26];
        Arrays.fill(last, -1);
        int left = 0, best = 0;
        for (int right = 0; right < s.length(); right++) {
            int c = s.charAt(right) - 'a';
            left = Math.max(left, last[c] + 1);
            last[c] = right;
            best = Math.max(best, right - left + 1);
        }
        System.out.println(best);`),
  },
  'grid-paths': {
    cpp: cpp(String.raw`    int n, m; cin >> n >> m;
    const long long MOD = 1000000007;
    vector<long long> dp(m, 0);
    dp[0] = 1;
    for (int r = 0; r < n; ++r) {
        string row; cin >> row;
        for (int c = 0; c < m; ++c) {
            if (row[c] == '#') dp[c] = 0;
            else if (c > 0) dp[c] = (dp[c] + dp[c - 1]) % MOD;
        }
    }
    cout << dp[m - 1] << '\n';`),
    python: python(`data = sys.stdin.buffer.read().split()
n, m = int(data[0]), int(data[1])
mod = 1000000007
dp = [0] * m
dp[0] = 1
for row in data[2:2 + n]:
    for c in range(m):
        if row[c] == ord('#'):
            dp[c] = 0
        elif c > 0:
            dp[c] = (dp[c] + dp[c - 1]) % mod
print(dp[-1])`),
    javascript: javascript(`const n = Number(tokens[0]), m = Number(tokens[1]), MOD = 1000000007;
const dp = Array(m).fill(0);
dp[0] = 1;
for (let r = 0; r < n; r++) {
  const row = tokens[2 + r];
  for (let c = 0; c < m; c++) {
    if (row[c] === '#') dp[c] = 0;
    else if (c > 0) dp[c] = (dp[c] + dp[c - 1]) % MOD;
  }
}
console.log(dp[m - 1]);`),
    java: java(`        int n = in.nextInt(), m = in.nextInt();
        long[] dp = new long[m];
        dp[0] = 1;
        for (int r = 0; r < n; r++) {
            String row = in.next();
            for (int c = 0; c < m; c++) {
                if (row.charAt(c) == '#') dp[c] = 0;
                else if (c > 0) dp[c] = (dp[c] + dp[c - 1]) % 1000000007;
            }
        }
        System.out.println(dp[m - 1]);`),
  },
  'minimum-coins': {
    cpp: cpp(String.raw`    int n, amount; cin >> n >> amount;
    vector<int> coins(n), dp(amount + 1, amount + 1);
    for (int &coin : coins) cin >> coin;
    dp[0] = 0;
    for (int value = 1; value <= amount; ++value) {
        for (int coin : coins) if (coin <= value)
            dp[value] = min(dp[value], dp[value - coin] + 1);
    }
    cout << (dp[amount] <= amount ? dp[amount] : -1) << '\n';`),
    python: python(`data = list(map(int, sys.stdin.buffer.read().split()))
n, amount = data[0], data[1]
coins = data[2:2 + n]
dp = [amount + 1] * (amount + 1)
dp[0] = 0
for value in range(1, amount + 1):
    for coin in coins:
        if coin <= value:
            dp[value] = min(dp[value], dp[value - coin] + 1)
print(dp[amount] if dp[amount] <= amount else -1)`),
    javascript: javascript(`const n = Number(tokens[0]), amount = Number(tokens[1]);
const coins = tokens.slice(2, 2 + n).map(Number), dp = Array(amount + 1).fill(amount + 1);
dp[0] = 0;
for (let value = 1; value <= amount; value++) {
  for (const coin of coins) {
    if (coin <= value) dp[value] = Math.min(dp[value], dp[value - coin] + 1);
  }
}
console.log(dp[amount] <= amount ? dp[amount] : -1);`),
    java: java(`        int n = in.nextInt(), amount = in.nextInt();
        int[] coins = new int[n], dp = new int[amount + 1];
        for (int i = 0; i < n; i++) coins[i] = in.nextInt();
        Arrays.fill(dp, amount + 1);
        dp[0] = 0;
        for (int value = 1; value <= amount; value++) {
            for (int coin : coins) if (coin <= value)
                dp[value] = Math.min(dp[value], dp[value - coin] + 1);
        }
        System.out.println(dp[amount] <= amount ? dp[amount] : -1);`),
  },
  'course-order': {
    cpp: cpp(String.raw`    int n, m; cin >> n >> m;
    vector<vector<int>> graph(n);
    vector<int> indegree(n, 0);
    for (int i = 0; i < m; ++i) {
        int from, to; cin >> from >> to; --from; --to;
        graph[from].push_back(to); ++indegree[to];
    }
    queue<int> ready;
    for (int v = 0; v < n; ++v) if (indegree[v] == 0) ready.push(v);
    int completed = 0;
    while (!ready.empty()) {
        int v = ready.front(); ready.pop(); ++completed;
        for (int to : graph[v]) if (--indegree[to] == 0) ready.push(to);
    }
    cout << (completed == n ? "YES" : "NO") << '\n';`),
    python: python(`from collections import deque
data = list(map(int, sys.stdin.buffer.read().split()))
n, m = data[0], data[1]
graph = [[] for _ in range(n)]
indegree = [0] * n
for i in range(m):
    start, end = data[2 + 2 * i] - 1, data[3 + 2 * i] - 1
    graph[start].append(end)
    indegree[end] += 1
ready = deque(v for v in range(n) if indegree[v] == 0)
completed = 0
while ready:
    vertex = ready.popleft()
    completed += 1
    for end in graph[vertex]:
        indegree[end] -= 1
        if indegree[end] == 0:
            ready.append(end)
print('YES' if completed == n else 'NO')`),
    javascript: javascript(`const n = Number(tokens[0]), m = Number(tokens[1]);
const graph = Array.from({ length: n }, () => []), indegree = Array(n).fill(0);
for (let i = 0; i < m; i++) {
  const from = Number(tokens[2 + 2 * i]) - 1, to = Number(tokens[3 + 2 * i]) - 1;
  graph[from].push(to); indegree[to]++;
}
const ready = [];
for (let v = 0; v < n; v++) if (indegree[v] === 0) ready.push(v);
let head = 0;
while (head < ready.length) {
  const v = ready[head++];
  for (const to of graph[v]) if (--indegree[to] === 0) ready.push(to);
}
console.log(head === n ? 'YES' : 'NO');`),
    java: java(`        int n = in.nextInt(), m = in.nextInt();
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
        int[] indegree = new int[n];
        for (int i = 0; i < m; i++) {
            int from = in.nextInt() - 1, to = in.nextInt() - 1;
            graph.get(from).add(to); indegree[to]++;
        }
        Deque<Integer> ready = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indegree[v] == 0) ready.add(v);
        int completed = 0;
        while (!ready.isEmpty()) {
            int v = ready.removeFirst(); completed++;
            for (int to : graph.get(v)) if (--indegree[to] == 0) ready.addLast(to);
        }
        System.out.println(completed == n ? "YES" : "NO");`),
  },
  'inversion-count': {
    cpp: cpp(
      String.raw`    int n; cin >> n;
    vector<long long> a(n), temp(n);
    for (auto &value : a) cin >> value;
    cout << countInversions(a, temp, 0, n) << '\n';`,
      String.raw`long long countInversions(vector<long long>& a, vector<long long>& temp, int left, int right) {
    if (right - left <= 1) return 0;
    int mid = left + (right - left) / 2;
    long long count = countInversions(a, temp, left, mid) + countInversions(a, temp, mid, right);
    int i = left, j = mid, k = left;
    while (i < mid && j < right) {
        if (a[i] <= a[j]) temp[k++] = a[i++];
        else { temp[k++] = a[j++]; count += mid - i; }
    }
    while (i < mid) temp[k++] = a[i++];
    while (j < right) temp[k++] = a[j++];
    for (int p = left; p < right; ++p) a[p] = temp[p];
    return count;
}`,
    ),
    python: python(`data = list(map(int, sys.stdin.buffer.read().split()))
n, a = data[0], data[1:]
temp = [0] * n
def count_inversions(left, right):
    if right - left <= 1:
        return 0
    mid = (left + right) // 2
    count = count_inversions(left, mid) + count_inversions(mid, right)
    i, j, k = left, mid, left
    while i < mid and j < right:
        if a[i] <= a[j]:
            temp[k] = a[i]
            i += 1
        else:
            temp[k] = a[j]
            j += 1
            count += mid - i
        k += 1
    while i < mid:
        temp[k] = a[i]
        i += 1
        k += 1
    while j < right:
        temp[k] = a[j]
        j += 1
        k += 1
    for p in range(left, right):
        a[p] = temp[p]
    return count
print(count_inversions(0, n))`),
    javascript: javascript(`const n = Number(tokens[0]), a = tokens.slice(1).map(Number), temp = Array(n);
function countInversions(left, right) {
  if (right - left <= 1) return 0;
  const mid = Math.floor((left + right) / 2);
  let count = countInversions(left, mid) + countInversions(mid, right);
  let i = left, j = mid, k = left;
  while (i < mid && j < right) {
    if (a[i] <= a[j]) temp[k++] = a[i++];
    else { temp[k++] = a[j++]; count += mid - i; }
  }
  while (i < mid) temp[k++] = a[i++];
  while (j < right) temp[k++] = a[j++];
  for (let p = left; p < right; p++) a[p] = temp[p];
  return count;
}
// At most n*(n-1)/2 = 4,999,950,000, exactly representable by Number.
console.log(countInversions(0, n));`),
    java: java(
      `        int n = in.nextInt();
        long[] a = new long[n], temp = new long[n];
        for (int i = 0; i < n; i++) a[i] = in.nextLong();
        System.out.println(countInversions(a, temp, 0, n));`,
      `    static long countInversions(long[] a, long[] temp, int left, int right) {
        if (right - left <= 1) return 0;
        int mid = left + (right - left) / 2;
        long count = countInversions(a, temp, left, mid) + countInversions(a, temp, mid, right);
        int i = left, j = mid, k = left;
        while (i < mid && j < right) {
            if (a[i] <= a[j]) temp[k++] = a[i++];
            else { temp[k++] = a[j++]; count += mid - i; }
        }
        while (i < mid) temp[k++] = a[i++];
        while (j < right) temp[k++] = a[j++];
        for (int p = left; p < right; p++) a[p] = temp[p];
        return count;
    }`,
    ),
  },
};
