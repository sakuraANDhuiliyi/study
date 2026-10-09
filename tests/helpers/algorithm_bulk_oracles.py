# -*- coding: utf-8 -*-
"""Independent maintenance oracles for the original expansion exercises.
Only repository-authored fixed data are accepted by the calling unit test; no student source is executed.
"""
import sys,json,math,itertools,collections,heapq,re
MOD=1000000007

def solve(id,s):
    t=s.split();a=list(map(int,t)) if all(re.fullmatch(r'-?\d+',x) for x in t) else []
    if id=='euclidean-gcd':return math.gcd(*a)
    if id=='common-period':return math.lcm(*a)
    if id=='modular-power':return pow(a[0],a[1],a[2])
    if id=='prime-check':
        n=a[0];return 'YES' if n>1 and all(n%d for d in range(2,math.isqrt(n)+1)) else 'NO'
    if id=='prime-count':
        n=a[0];sieve=[True]*(n+1)
        if n>=0:sieve[0]=False
        if n>=1:sieve[1]=False
        for d in range(2,math.isqrt(n)+1):
            if sieve[d]:sieve[d*d:n+1:d]=[False]*len(range(d*d,n+1,d))
        return sum(sieve)
    if id=='divisor-count':
        n=a[0];return sum(1 if d*d==n else 2 for d in range(1,math.isqrt(n)+1) if n%d==0)
    if id=='factorial-zeros':
        n=a[0];return sum(n//(5**k) for k in range(1,20))
    if id=='base-conversion':
        n,b=a;out='';digits='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        while n:out=digits[n%b]+out;n//=b
        return out or '0'
    if id=='pascal-choice':return math.comb(*a)%MOD
    if id=='fibonacci-mod':
        n=a[0];mat=(1,1,1,0);r=(1,0,0,1)
        def mul(x,y):return tuple(sum(x[i*2+k]*y[k*2+j] for k in range(2))%MOD for i in range(2) for j in range(2))
        while n:
            if n&1:r=mul(r,mat)
            mat=mul(mat,mat);n//=2
        return r[1]
    if id=='nim-winning':return 'FIRST' if __import__('functools').reduce(lambda x,y:x^y,a[1:],0) else 'SECOND'
    if id=='coprime-count':
        n=a[0];r=n;p=2
        while p*p<=n:
            if n%p==0:
                r=r//p*(p-1)
                while n%p==0:n//=p
            p+=1
        return r//n*(n-1) if n>1 else r
    if id=='unique-values':return len(set(a[1:]))
    if id=='second-distinct':
        b=sorted(set(a[1:]));return b[-2] if len(b)>1 else 'NONE'
    if id=='majority-ballot':
        c=collections.Counter(a[1:]);return next((x for x,n in c.items() if n>a[0]//2),'NONE')
    if id=='sorted-deduplicate':
        b=sorted(set(a[1:]));return str(len(b))+'\n'+' '.join(map(str,b))
    if id=='rotate-array':
        n,k=a[:2];b=a[2:];k%=n;return ' '.join(map(str,b[-k:]+b[:-k] if k else b))
    if id=='mex-number':
        b=set(a[1:]);return next(x for x in range(a[0]+1) if x not in b)
    if id=='pair-difference':
        n,k=a[:2];return sum(abs(x-y)==k for x,y in itertools.combinations(a[2:],2))
    if id in ['odd-subarrays','zero-sum-subarrays']:
        b=a[1:];return sum((sum(b[i:j])%2==1 if id=='odd-subarrays' else sum(b[i:j])==0) for i in range(len(b)) for j in range(i+1,len(b)+1))
    if id=='product-except-self':return ' '.join(str(math.prod(a[1:i+1]+a[i+2:])%MOD) for i in range(a[0]))
    if id=='minimum-value-gap':return min(abs(x-y) for x,y in itertools.combinations(a[1:],2))
    if id=='median-movement':return min(sum(abs(x-v) for v in a[1:]) for x in a[1:])
    if id=='shortest-positive-window':
        n,target=a[:2];b=a[2:];return min([j-i for i in range(n) for j in range(i+1,n+1) if sum(b[i:j])>=target],default=0)
    if id=='fixed-window-total':
        n,k=a[:2];return max(sum(a[2+i:2+i+k]) for i in range(n-k+1))
    if id=='range-increments':
        n,q=a[:2];b=a[2:2+n]
        for l,r,v in zip(a[2+n::3],a[3+n::3],a[4+n::3]):
            for i in range(l-1,r):b[i]+=v
        return ' '.join(map(str,b))
    if id=='range-xor':
        n,q=a[:2];b=a[2:2+n];return '\n'.join(str(__import__('functools').reduce(lambda x,y:x^y,b[l-1:r],0)) for l,r in zip(a[2+n::2],a[3+n::2]))
    if id in ['stack-journal','queue-journal','priority-dispatch']:
        lines=s.splitlines()[1:];b=[];out=[]
        for line in lines:
            op,*v=line.split()
            if op in ['PUSH','ENQUEUE','ADD']:b.append(int(v[0]))
            elif not b:out.append('EMPTY')
            elif op=='TOP':out.append(str(b[-1]))
            elif op=='FRONT':out.append(str(b[0]))
            elif op=='POP':out.append(str(b.pop()))
            elif op=='DEQUEUE':out.append(str(b.pop(0)))
            else:x=min(b);b.remove(x);out.append(str(x))
        return '\n'.join(out)
    if id=='next-greater-index':
        b=a[1:];return ' '.join(str(next((j+1 for j in range(i+1,len(b)) if b[j]>v),0)) for i,v in enumerate(b))
    if id=='window-maximum':
        n,k=a[:2];return ' '.join(str(max(a[i+2:i+2+k])) for i in range(n-k+1))
    if id=='histogram-area':
        b=a[1:];return max(min(b[i:j])*(j-i) for i in range(len(b)) for j in range(i+1,len(b)+1))
    if id=='kth-ranked':return sorted(a[2:])[a[1]-1]
    if id=='dynamic-range-sum':
        lines=s.splitlines();b=list(map(int,lines[1].split()));out=[]
        for line in lines[2:]:
            op,x,y=line.split();x=int(x);y=int(y)
            if op=='ADD':b[x-1]+=y
            else:out.append(str(sum(b[x-1:y])))
        return '\n'.join(out)
    if id=='anagram-labels':return 'YES' if sorted(t[0])==sorted(t[1]) else 'NO'
    if id=='run-length-encode':return ''.join(c+str(len(list(g))) for c,g in itertools.groupby(t[0]))
    if id=='run-length-decode':return ''.join(c*int(n) for c,n in re.findall(r'([a-z])(\d+)',t[0]))
    if id=='shortest-string-period':return next(k for k in range(1,len(t[0])+1) if len(t[0])%k==0 and t[0][:k]*(len(t[0])//k)==t[0])
    if id=='pattern-occurrences':return sum(t[0].startswith(t[1],i) for i in range(len(t[0])))
    if id in ['longest-palindrome-length','palindrome-substring-count']:
        b=t[0];v=[j-i for i in range(len(b)) for j in range(i+1,len(b)+1) if b[i:j]==b[i:j][::-1]]
        return max(v) if id=='longest-palindrome-length' else len(v)
    if id=='subsequence-check':
        iterator=iter(t[0]);return 'YES' if all(c in iterator for c in t[1]) else 'NO'
    if id=='caesar-shift':return ''.join(chr(97+(ord(c)-97+int(t[0]))%26) for c in t[1])
    if id=='minimum-rotation':return min(t[0][i:]+t[0][:i] for i in range(len(t[0])))
    if id=='word-frequency':return '\n'.join(w+' '+str(c) for w,c in sorted(collections.Counter(t[1:]).items()))
    if id=='bracket-insertions':
        b=t[0]
        while '()' in b:b=b.replace('()','')
        return len(b)
    if id=='nonoverlap-events':
        n=a[0];b=list(zip(a[1::2],a[2::2]));best=0
        for mask in range(1<<n):
            chosen=sorted(b[i] for i in range(n) if mask>>i&1)
            if all(chosen[i][1]<=chosen[i+1][0] for i in range(len(chosen)-1)):best=max(best,len(chosen))
        return best
    if id=='minimum-rooms':
        b=list(zip(a[1::2],a[2::2]));return max((sum(l<=x<r for l,r in b) for x,y in b),default=0)
    if id=='deadline-reward':
        b=list(zip(a[1::2],a[2::2]));best=-10**30
        for p in itertools.permutations(b):
            clock=0;r=0
            for time,d in p:clock+=time;r+=d-clock
            best=max(best,r)
        return best
    if id=='merge-batch-cost':
        @__import__('functools').lru_cache(None)
        def rec(b):
            if len(b)==1:return 0
            return min(b[i]+b[j]+rec(tuple(sorted([v for k,v in enumerate(b) if k not in [i,j]]+[b[i]+b[j]]))) for i in range(len(b)) for j in range(i+1,len(b)))
        return rec(tuple(sorted(a[1:])))
    if id=='two-person-carriers':
        n,w=a[:2];b=a[2:]
        @__import__('functools').lru_cache(None)
        def rec(mask):
            if not mask:return 0
            i=next(i for i in range(n) if mask>>i&1);rest=mask^(1<<i)
            return min([1+rec(rest)]+[1+rec(rest^(1<<j)) for j in range(i+1,n) if rest>>j&1 and b[i]+b[j]<=w])
        return rec((1<<n)-1)
    if id=='tolerance-matching':
        n,m,k=a[:3];x=a[3:3+n];y=a[3+n:]
        def rec(i,used):
            if i==n:return 0
            return max([rec(i+1,used)]+[1+rec(i+1,used|1<<j) for j in range(m) if not used>>j&1 and abs(x[i]-y[j])<=k])
        return rec(0,0)
    if id=='factory-target-time':
        n,k=a[:2];b=a[2:]
        if n==1:return b[0]*k
        h=[(x,x) for x in b];heapq.heapify(h)
        for _ in range(k):v,x=heapq.heappop(h);heapq.heappush(h,(v+x,x))
        return v
    if id=='contiguous-capacity':
        n,k=a[:2];b=a[2:];best=sum(b)
        for mask in range(1<<max(n-1,0)):
            if bin(mask).count('1')+1>k:continue
            chunks=[];c=0
            for i,x in enumerate(b):
                c+=x
                if i==n-1 or mask>>i&1:chunks.append(c);c=0
            best=min(best,max(chunks))
        return best
    if id=='minimum-jumps':
        n=a[0];b=a[1:];d=[-1]*n;d[0]=0;q=collections.deque([0])
        while q:
            i=q.popleft()
            for j in range(i+1,min(n,i+b[i]+1)):
                if d[j]<0:d[j]=d[i]+1;q.append(j)
        return d[-1]
    if id=='missing-subset-sum':
        sums={0}
        for x in a[1:]:sums|={v+x for v in sums}
        return next(x for x in range(1,sum(a[1:])+2) if x not in sums)
    if id=='increasing-subsequence':
        b=a[1:];dp=[1]*len(b)
        for i in range(len(b)):
            dp[i]=1+max([dp[j] for j in range(i) if b[j]<b[i]],default=0)
        return max(dp)
    if id in ['common-subsequence','edit-distance']:
        x,y=t;dp=[[0]*(len(y)+1) for _ in range(len(x)+1)]
        if id=='edit-distance':
            for i in range(len(x)+1):dp[i][0]=i
            for j in range(len(y)+1):dp[0][j]=j
        for i in range(1,len(x)+1):
            for j in range(1,len(y)+1):
                dp[i][j]=(dp[i-1][j-1]+1 if x[i-1]==y[j-1] else max(dp[i-1][j],dp[i][j-1])) if id=='common-subsequence' else min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(x[i-1]!=y[j-1]))
        return dp[-1][-1]
    if id=='zero-one-knapsack':
        n,c=a[:2];b=list(zip(a[2::2],a[3::2]));return max(sum(b[i][1] for i in range(n) if mask>>i&1) for mask in range(1<<n) if sum(b[i][0] for i in range(n) if mask>>i&1)<=c)
    if id=='ordered-coin-ways':
        n,s=a[:2];b=a[2:]
        @__import__('functools').lru_cache(None)
        def f(x):return 1 if x==0 else sum(f(x-c) for c in b if c<=x)%MOD
        return f(s)
    if id=='unordered-coin-ways':
        n,s=a[:2];b=a[2:]
        @__import__('functools').lru_cache(None)
        def f(i,x):
            if i==n:return int(x==0)
            return sum(f(i+1,x-k*b[i]) for k in range(x//b[i]+1))%MOD
        return f(0,s)
    if id=='subset-target':
        n,target=a[:2];b=a[2:];return 'YES' if any(sum(b[i] for i in range(n) if mask>>i&1)==target for mask in range(1<<n)) else 'NO'
    if id=='integer-partitions':
        n=a[0];pentagonal=[0]*(n+1);pentagonal[0]=1
        for x in range(1,n+1):
            k=1
            while k*(3*k-1)//2<=x:
                sign=1 if k%2 else -1
                for g in [k*(3*k-1)//2,k*(3*k+1)//2]:
                    if g<=x:pentagonal[x]+=sign*pentagonal[x-g]
                k+=1
            pentagonal[x]%=MOD
        return pentagonal[n]
    if id=='bounded-hop-cost':
        n,k=a[:2];b=a[2:]
        @__import__('functools').lru_cache(None)
        def f(i):return 0 if i==n-1 else min(abs(b[i]-b[j])+f(j) for j in range(i+1,min(n,i+k+1)))
        return f(0)
    if id=='nonadjacent-value':
        b=a[1:];n=len(b);return max(sum(b[i] for i in range(n) if mask>>i&1) for mask in range(1<<n) if not mask&(mask<<1))
    if id=='grid-minimum-cost':
        r,c=a[:2];b=a[2:]
        def f(i,j):
            if i==r-1 and j==c-1:return b[i*c+j]
            return b[i*c+j]+min([f(i+1,j)] if j==c-1 else [f(i,j+1)] if i==r-1 else [f(i+1,j),f(i,j+1)])
        return f(0,0)
    if id=='largest-one-square':
        r,c=map(int,t[:2]);b=t[2:];return max([0]+[k*k for k in range(1,min(r,c)+1) for i in range(r-k+1) for j in range(c-k+1) if all(b[x][y]=='1' for x in range(i,i+k) for y in range(j,j+k))])
    if id=='rod-cut-value':
        n=a[0];p=a[1:]
        @__import__('functools').lru_cache(None)
        def f(l):return 0 if l==0 else max(p[k-1]+f(l-k) for k in range(1,l+1))
        return f(n)
    if id=='matrix-chain-cost':
        n=a[0];d=a[1:]
        @__import__('functools').lru_cache(None)
        def f(l,r):return 0 if l==r else min(f(l,k)+f(k+1,r)+d[l]*d[k+1]*d[r+1] for k in range(l,r))
        return f(0,n-1)
    if id=='palindromic-subsequence':
        b=t[0];n=len(b);return max(len(x) for mask in range(1<<n) if (x:=''.join(b[i] for i in range(n) if mask>>i&1))==x[::-1])
    if id=='end-picking-game':
        b=a[1:]
        @__import__('functools').lru_cache(None)
        def f(l,r):return b[l] if l==r else max(b[l]-f(l+1,r),b[r]-f(l,r-1))
        return f(0,len(b)-1)
    if id=='unweighted-distance':
        n,m,source,target=a[:4];edges=list(zip(a[4::2],a[5::2]));d=[[math.inf]*n for _ in range(n)]
        for i in range(n):d[i][i]=0
        for u,v in edges:d[u-1][v-1]=min(d[u-1][v-1],1);d[v-1][u-1]=min(d[v-1][u-1],1)
        for k in range(n):
            for i in range(n):
                for j in range(n):d[i][j]=min(d[i][j],d[i][k]+d[k][j])
        return -1 if d[source-1][target-1]==math.inf else d[source-1][target-1]
    if id=='bipartite-check':
        n,m=a[:2];e=list(zip(a[2::2],a[3::2]));return 'YES' if any(all((mask>>(u-1)&1)!=(mask>>(v-1)&1) for u,v in e) for mask in range(1<<n)) else 'NO'
    if id=='directed-reach-count':
        n,m,source=a[:3];seen={source};e=list(zip(a[3::2],a[4::2]));old=-1
        while old!=len(seen):old=len(seen);seen|={v for u,v in e if u in seen}
        return len(seen)
    if id=='strong-component-count':
        n,m=a[:2];reach=[[i==j for j in range(n)] for i in range(n)]
        for u,v in zip(a[2::2],a[3::2]):reach[u-1][v-1]=True
        for k in range(n):
            for i in range(n):
                for j in range(n):reach[i][j]|=reach[i][k] and reach[k][j]
        seen=set();answer=0
        for i in range(n):
            if i not in seen:answer+=1;seen|={j for j in range(n) if reach[i][j] and reach[j][i]}
        return answer
    if id in ['dag-longest-edges','dag-path-count']:
        n,m=a[:2];g=[[] for _ in range(n)]
        for u,v in zip(a[2::2],a[3::2]):g[u-1].append(v-1)
        state=[0]*n;longest=[0]*n;ways=[0]*n
        def f(u):
            if state[u]==1:raise ValueError('cycle')
            if state[u]==2:return
            state[u]=1;ways[u]=int(u==n-1)
            for v in g[u]:f(v);longest[u]=max(longest[u],1+longest[v]);ways[u]=(ways[u]+ways[v])%MOD
            state[u]=2
        try:
            for u in range(n):f(u)
        except ValueError:return -1
        return max(longest) if id=='dag-longest-edges' else ways[0]
    if id in ['all-pairs-routes','zero-one-distance','negative-cycle-check']:
        n,m=a[:2];offset=3 if id=='all-pairs-routes' else 4 if id=='zero-one-distance' else 2
        edges=[a[i:i+3] for i in range(offset,offset+3*m,3)];d=[[math.inf]*n for _ in range(n)]
        for i in range(n):d[i][i]=0
        for u,v,w in edges:d[u-1][v-1]=min(d[u-1][v-1],w)
        for k in range(n):
            for i in range(n):
                for j in range(n):d[i][j]=min(d[i][j],d[i][k]+d[k][j])
        if id=='negative-cycle-check':return 'YES' if any(d[i][i]<0 for i in range(n)) else 'NO'
        def result(u,v):return -1 if d[u-1][v-1]==math.inf else d[u-1][v-1]
        if id=='zero-one-distance':return result(a[2],a[3])
        return '\n'.join(str(result(u,v)) for u,v in zip(a[offset+3*m::2],a[offset+3*m+1::2]))
    if id in ['bridge-count','articulation-count']:
        n,m=a[:2];edges=list(zip(a[2::2],a[3::2]))
        def components(skip_vertex=None,skip_edge=None):
            seen=set();count=0
            for u in range(1,n+1):
                if u==skip_vertex or u in seen:continue
                count+=1;q=[u];seen.add(u)
                for x in q:
                    for i,(l,r) in enumerate(edges):
                        if i==skip_edge or skip_vertex in [l,r]:continue
                        v=r if x==l else l if x==r else None
                        if v and v not in seen:seen.add(v);q.append(v)
            return count
        baseline=components();return sum(components(skip_edge=i)>baseline for i in range(m)) if id=='bridge-count' else sum(components(skip_vertex=i)>baseline for i in range(1,n+1))
    if id=='euler-trail-check':
        n,m=a[:2];edges=list(zip(a[2::2],a[3::2]))
        def walk(u,used):
            if used==(1<<m)-1:return True
            return any(walk(v,used|1<<i) for i,(l,r) in enumerate(edges) if not used>>i&1 for v in ([r] if u==l else [l] if u==r else []))
        return 'YES' if m==0 or any(walk(u,0) for u in range(1,n+1)) else 'NO'
    if id=='bipartite-matching':
        l,r,m=a[:3];e=set(zip(a[3::2],a[4::2]))
        def f(u,used):
            if u>l:return 0
            return max([f(u+1,used)]+[1+f(u+1,used|1<<(v-1)) for v in range(1,r+1) if (u,v) in e and not used>>(v-1)&1])
        return f(1,0)
    if id=='maximum-network-flow':
        n,m,source,target=a[:4];edges=[a[i:i+3] for i in range(4,len(a),3)]
        return min(sum(w for u,v,w in edges if mask>>(u-1)&1 and not mask>>(v-1)&1) for mask in range(1<<n) if mask>>(source-1)&1 and not mask>>(target-1)&1)
    if id in ['tree-diameter','rooted-subtree-sizes','lowest-common-ancestor','tree-independent-count','tree-distance-sums','tree-maximum-matching']:
        n=a[0];offset=2 if id=='lowest-common-ancestor' else 1;edges=[tuple(a[i:i+2]) for i in range(offset,offset+2*(n-1),2)];g=[[] for _ in range(n)]
        for u,v in edges:g[u-1].append(v-1);g[v-1].append(u-1)
        def distances(source):
            d=[-1]*n;d[source]=0;q=[source]
            for u in q:
                for v in g[u]:
                    if d[v]<0:d[v]=d[u]+1;q.append(v)
            return d
        if id=='tree-diameter':return max(max(distances(i)) for i in range(n))
        if id=='tree-distance-sums':return ' '.join(str(sum(distances(i))) for i in range(n))
        parent=[-1]*n;parent[0]=0;q=[0]
        for u in q:
            for v in g[u]:
                if parent[v]<0:parent[v]=u;q.append(v)
        if id=='rooted-subtree-sizes':
            count=[0]*n
            for u in range(n):
                v=u;count[v]+=1
                while v: v=parent[v];count[v]+=1
            return ' '.join(map(str,count))
        if id=='lowest-common-ancestor':
            out=[]
            for u,v in zip(a[offset+2*(n-1)::2],a[offset+2*(n-1)+1::2]):
                u-=1;v-=1;ancestors={u}
                while u:u=parent[u];ancestors.add(u)
                while v not in ancestors:v=parent[v]
                out.append(str(v+1))
            return '\n'.join(out)
        if id=='tree-independent-count':return sum(all(not(mask>>(u-1)&1 and mask>>(v-1)&1) for u,v in edges) for mask in range(1<<n))%MOD
        best=0
        for mask in range(1<<len(edges)):
            vertices=[v for i,e in enumerate(edges) if mask>>i&1 for v in e]
            if len(vertices)==len(set(vertices)):best=max(best,len(vertices)//2)
        return best
    if id=='point-orientation':
        ax,ay,bx,by,cx,cy=a;z=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);return 'LEFT' if z>0 else 'RIGHT' if z<0 else 'COLLINEAR'
    if id=='segment-intersection':
        from fractions import Fraction
        ax,ay,bx,by,cx,cy,dx,dy=a;u=(bx-ax,by-ay);v=(dx-cx,dy-cy);w=(cx-ax,cy-ay);den=u[0]*v[1]-u[1]*v[0]
        if den:
            t=Fraction(w[0]*v[1]-w[1]*v[0],den);r=Fraction(w[0]*u[1]-w[1]*u[0],den)
            return 'YES' if 0<=t<=1 and 0<=r<=1 else 'NO'
        def contains(x,y,p,q):return (q[0]-p[0])*(y-p[1])==(q[1]-p[1])*(x-p[0]) and min(p[0],q[0])<=x<=max(p[0],q[0]) and min(p[1],q[1])<=y<=max(p[1],q[1])
        return 'YES' if contains(ax,ay,(cx,cy),(dx,dy)) or contains(bx,by,(cx,cy),(dx,dy)) or contains(cx,cy,(ax,ay),(bx,by)) or contains(dx,dy,(ax,ay),(bx,by)) else 'NO'
    if id=='polygon-double-area':
        points=list(zip(a[1::2],a[2::2]));origin=points[0];return abs(sum((points[i][0]-origin[0])*(points[i+1][1]-origin[1])-(points[i][1]-origin[1])*(points[i+1][0]-origin[0]) for i in range(1,len(points)-1)))
    if id=='point-in-polygon':
        from fractions import Fraction
        n,q=a[:2];points=list(zip(a[2:2+2*n:2],a[3:2+2*n:2]));queries=list(zip(a[2+2*n::2],a[3+2*n::2]));out=[]
        for x,y in queries:
            winding=0;bound=False
            for i,(ax,ay) in enumerate(points):
                bx,by=points[(i+1)%n];z=(bx-ax)*(y-ay)-(by-ay)*(x-ax)
                if z==0 and min(ax,bx)<=x<=max(ax,bx) and min(ay,by)<=y<=max(ay,by):bound=True;break
                if ay<=y<by and z>0:winding+=1
                if by<=y<ay and z<0:winding-=1
            out.append('BOUNDARY' if bound else 'INSIDE' if winding else 'OUTSIDE')
        return '\n'.join(out)
    if id=='maximum-manhattan':
        p=list(zip(a[1::2],a[2::2]));return max(abs(x-u)+abs(y-v) for x,y in p for u,v in p)
    if id=='convex-hull-vertices':
        p=sorted(set(zip(a[1::2],a[2::2])))
        if len(p)<3:return len(p)
        def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        start=p[0];current=start;count=0
        while True:
            nxt=next(x for x in p if x!=current)
            for candidate in p:
                if candidate==current:continue
                z=cross(current,nxt,candidate)
                if z<0 or z==0 and sum((candidate[i]-current[i])**2 for i in range(2))>sum((nxt[i]-current[i])**2 for i in range(2)):nxt=candidate
            count+=1;current=nxt
            if current==start:return count
    raise ValueError('Unknown fixed exercise: '+id)

if __name__=='__main__':
    rows=json.load(sys.stdin)
    print(json.dumps([str(solve(row['id'],row['input'])).rstrip()+'\n' for row in rows]))
