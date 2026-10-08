import type { AlgorithmEditorialLanguage } from './algorithms.editorials.types';

/** Fixed original teaching programs. Student code is executed only by the judge service. */
export const graphReferenceCode: Record<string, Record<AlgorithmEditorialLanguage, string>> = {
  'minimum-spanning-tree': {
    cpp: `#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
using namespace std;

struct Edge {
    int u, v;
    long long weight;
};

int findRoot(vector<int>& parent, int node) {
    while (parent[node] != node) {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    return node;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, m;
    cin >> n >> m;
    vector<Edge> edges(m);
    for (Edge& edge : edges) cin >> edge.u >> edge.v >> edge.weight;
    sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b) {
        return a.weight < b.weight;
    });
    vector<int> parent(n + 1), size(n + 1, 1);
    iota(parent.begin(), parent.end(), 0);
    long long total = 0;
    int selected = 0;
    for (const Edge& edge : edges) {
        int a = findRoot(parent, edge.u);
        int b = findRoot(parent, edge.v);
        if (a == b) continue;
        if (size[a] < size[b]) swap(a, b);
        parent[b] = a;
        size[a] += size[b];
        total += edge.weight;
        ++selected;
        if (selected == n - 1) break;
    }
    if (selected == n - 1) cout << total << '\\n';
    else cout << "IMPOSSIBLE\\n";
    return 0;
}
`,
    python: `import sys


def solve():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, m = data[0], data[1]
    edges = []
    offset = 2
    for _ in range(m):
        u, v, weight = data[offset], data[offset + 1], data[offset + 2]
        edges.append((weight, u, v))
        offset += 3
    edges.sort()
    parent = list(range(n + 1))
    size = [1] * (n + 1)

    def find_root(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    total = 0
    selected = 0
    for weight, u, v in edges:
        a, b = find_root(u), find_root(v)
        if a == b:
            continue
        if size[a] < size[b]:
            a, b = b, a
        parent[b] = a
        size[a] += size[b]
        total += weight
        selected += 1
        if selected == n - 1:
            break
    print(total if selected == n - 1 else "IMPOSSIBLE")


if __name__ == "__main__":
    solve()
`,
    javascript: `const fs = require('fs');
const tokens = fs.readFileSync(0, 'utf8').trim().split(/\\s+/);
let offset = 0;
const next = () => Number(tokens[offset++]);
const n = next(), m = next();
const edges = [];
for (let i = 0; i < m; i++) {
    const u = next(), v = next(), weight = next();
    edges.push([u, v, weight]);
}
edges.sort((a, b) => a[2] - b[2]);
const parent = Array.from({ length: n + 1 }, (_, i) => i);
const size = new Array(n + 1).fill(1);
function findRoot(node) {
    while (parent[node] !== node) {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    return node;
}
// At most n-1 selected edges: |total| <= 99999 * 10^9 < 2^53-1.
// Every integer input and intermediate sum is therefore exact with Number.
let total = 0;
let selected = 0;
for (const [u, v, weight] of edges) {
    let a = findRoot(u), b = findRoot(v);
    if (a === b) continue;
    if (size[a] < size[b]) [a, b] = [b, a];
    parent[b] = a;
    size[a] += size[b];
    total += weight;
    selected++;
    if (selected === n - 1) break;
}
process.stdout.write((selected === n - 1 ? String(total) : 'IMPOSSIBLE') + '\\n');
`,
    java: `import java.io.*;
import java.util.*;

public class Main {
    static class FastScanner {
        private final InputStream input = System.in;
        private final byte[] buffer = new byte[1 << 16];
        private int cursor = 0, length = 0;
        private int read() throws IOException {
            if (cursor >= length) {
                length = input.read(buffer);
                cursor = 0;
                if (length <= 0) return -1;
            }
            return buffer[cursor++];
        }
        int nextInt() throws IOException {
            int c;
            do { c = read(); } while (c <= 32 && c != -1);
            int sign = 1;
            if (c == '-') { sign = -1; c = read(); }
            int value = 0;
            while (c > 32) {
                value = value * 10 + c - '0';
                c = read();
            }
            return value * sign;
        }
    }

    static class Edge {
        int u, v;
        long weight;
        Edge(int u, int v, long weight) {
            this.u = u;
            this.v = v;
            this.weight = weight;
        }
    }

    static int findRoot(int[] parent, int node) {
        while (parent[node] != node) {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        return node;
    }

    public static void main(String[] args) throws Exception {
        FastScanner input = new FastScanner();
        int n = input.nextInt(), m = input.nextInt();
        Edge[] edges = new Edge[m];
        for (int i = 0; i < m; i++)
            edges[i] = new Edge(input.nextInt(), input.nextInt(), input.nextInt());
        Arrays.sort(edges, Comparator.comparingLong(edge -> edge.weight));
        int[] parent = new int[n + 1];
        int[] size = new int[n + 1];
        for (int i = 0; i <= n; i++) { parent[i] = i; size[i] = 1; }
        long total = 0;
        int selected = 0;
        for (Edge edge : edges) {
            int a = findRoot(parent, edge.u), b = findRoot(parent, edge.v);
            if (a == b) continue;
            if (size[a] < size[b]) { int swap = a; a = b; b = swap; }
            parent[b] = a;
            size[a] += size[b];
            total += edge.weight;
            selected++;
            if (selected == n - 1) break;
        }
        if (selected == n - 1) System.out.println(total);
        else System.out.println("IMPOSSIBLE");
    }
}
`,
  },
};
