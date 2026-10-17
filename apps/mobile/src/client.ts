export type MobileUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  roles: string[];
  permissions: string[];
  organizationId: string;
  accountMode: string;
};
export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  sessionExpiresAt: string;
  user: MobileUser;
};
export type SessionStorage = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
};
export class MobileApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function serverOrigin(value: string, allowLocal = false) {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/api', '/api/'].includes(url.pathname) ||
    !(url.protocol === 'https:' || (allowLocal && local && url.protocol === 'http:'))
  )
    throw new Error('请填写完整的 HTTPS 平台地址；本地预览仅允许回环地址或模拟器宿主地址。');
  return url.origin;
}
function validSession(value: unknown): value is MobileSession {
  const s = value as MobileSession | null;
  return (
    !!s &&
    /^ma1_[A-Za-z0-9_-]{43}$/.test(s.accessToken) &&
    /^mr1_[A-Za-z0-9_-]{64}$/.test(s.refreshToken) &&
    Number.isFinite(Date.parse(s.accessExpiresAt)) &&
    Number.isFinite(Date.parse(s.sessionExpiresAt)) &&
    !!s.user?.id &&
    typeof s.user.name === 'string' &&
    Array.isArray(s.user.permissions)
  );
}
export class MobileClient {
  private session: MobileSession | null = null;
  private generation = 0;
  private refreshWork: Promise<void> | null = null;
  private storageWork: Promise<void> = Promise.resolve();
  constructor(
    readonly origin: string,
    private storage: SessionStorage,
    private changed: (user: MobileUser | null) => void,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async save(session: MobileSession | null, generation: number) {
    const work = this.storageWork
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation) return;
        if (session) await this.storage.set(JSON.stringify({ origin: this.origin, session }));
        else await this.storage.remove();
      });
    this.storageWork = work;
    await work;
  }
  private async wire(path: string, body?: unknown, method = 'GET', token?: string) {
    if (!/^\/[a-zA-Z0-9][^\\]*$/.test(path) || path.startsWith('//') || path.includes('://'))
      throw new Error('请求路径无效');
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}/api${path}`, {
        method,
        credentials: 'omit',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new MobileApiError(0, '无法连接平台，请检查地址、网络及服务器状态。');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new MobileApiError(
        response.status,
        response.status === 404 && path.startsWith('/mobile/auth/')
          ? '此服务器尚未启用手机端接口，请先升级服务器。'
          : typeof data?.error?.message === 'string'
            ? data.error.message
            : '请求未完成，请稍后重试。',
      );
    return data;
  }
  async restore() {
    const generation = ++this.generation;
    const raw = await this.storage.get();
    if (generation !== this.generation || !raw) return;
    try {
      const saved = JSON.parse(raw);
      if (saved.origin !== this.origin || !validSession(saved.session)) throw new Error('invalid session');
      this.session = saved.session;
    } catch {
      await this.clear();
      return;
    }
    const result = await this.request<{ user: MobileUser }>('/mobile/auth/me');
    if (generation === this.generation && this.session) {
      this.session = { ...this.session, user: result.user };
      this.changed(result.user);
    }
  }
  async login(username: string, password: string) {
    const generation = ++this.generation;
    this.session = null;
    this.changed(null);
    await this.save(null, generation);
    const data = await this.wire(
      '/mobile/auth/login',
      { username: username.trim(), password, deviceName: '知学 Android' },
      'POST',
    );
    if (generation !== this.generation) throw new MobileApiError(409, '登录状态已变化，请重试');
    if (!validSession(data)) throw new MobileApiError(502, '服务器登录响应格式无效');
    this.session = data;
    try {
      await this.save(data, generation);
    } catch {
      this.session = null;
      throw new Error('无法安全保存登录，请检查设备存储后重试。');
    }
    if (generation === this.generation) this.changed(data.user);
  }
  private async refresh(generation: number) {
    if (this.refreshWork) return this.refreshWork;
    const session = this.session;
    if (!session) throw new MobileApiError(401, '请重新登录');
    const work = (async () => {
      const data = await this.wire('/mobile/auth/refresh', { refreshToken: session.refreshToken }, 'POST');
      if (generation !== this.generation) throw new MobileApiError(409, '登录身份已变化');
      if (!validSession(data)) throw new MobileApiError(502, '服务器续期响应格式无效');
      this.session = data;
      await this.save(data, generation);
    })();
    this.refreshWork = work;
    try {
      await work;
    } finally {
      if (this.refreshWork === work) this.refreshWork = null;
    }
  }
  async request<T = any>(path: string, body?: unknown, method = 'GET'): Promise<T> {
    const generation = this.generation;
    if (!this.session) throw new MobileApiError(401, '请先登录');
    try {
      if (Date.parse(this.session.accessExpiresAt) <= Date.now() + 15000) await this.refresh(generation);
      const token = this.session!.accessToken;
      let result;
      try {
        result = await this.wire(path, body, method, token);
      } catch (error) {
        if (!(error instanceof MobileApiError) || error.status !== 401 || generation !== this.generation)
          throw error;
        if (this.session?.accessToken === token) await this.refresh(generation);
        result = await this.wire(path, body, method, this.session?.accessToken);
      }
      if (generation !== this.generation) throw new MobileApiError(409, '响应所属的登录身份已变化');
      return result;
    } catch (error) {
      if (generation === this.generation && error instanceof MobileApiError && error.status === 401)
        await this.clear();
      throw error;
    }
  }
  async logout() {
    await this.request('/mobile/auth/logout', {}, 'POST');
    await this.clear();
  }
  async clear() {
    const generation = ++this.generation;
    this.session = null;
    this.changed(null);
    await this.save(null, generation);
  }
}
