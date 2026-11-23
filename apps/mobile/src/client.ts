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
export type MobileBinary = { bytes: Uint8Array; contentType: string; filename: string };
type MobileTransfer = {
  multipart?: boolean;
  binary?: boolean;
  metadata?: boolean;
  maxBytes?: number;
  signal?: AbortSignal;
};
function transferSignal(timeout: AbortSignal, external?: AbortSignal) {
  if (!external) return timeout;
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    timeout.removeEventListener('abort', abort);
    external.removeEventListener('abort', abort);
  };
  if (timeout.aborted || external.aborted) abort();
  else {
    timeout.addEventListener('abort', abort, { once: true });
    external.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}
export function mobileDownloadFilename(disposition: string | null) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const raw = disposition?.match(/filename="([^"\r\n]*)"|filename=([^;\r\n]+)/i);
  let name = raw?.[1] || raw?.[2] || 'download.bin';
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {}
  }
  name = name
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return name || 'download.bin';
}
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
  private identityCleanup = new Set<() => void>();
  onSessionInvalidated(cleanup: () => void) {
    this.identityCleanup.add(cleanup);
    return () => {
      this.identityCleanup.delete(cleanup);
    };
  }
  private invalidateResources() {
    for (const cleanup of this.identityCleanup) {
      try {
        cleanup();
      } catch {}
    }
  }
  private generation = 0;
  private refreshWork: Promise<void> | null = null;
  private accessListeners = new Set<() => void>();
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
  private async wire(
    path: string,
    body?: unknown,
    method = 'GET',
    token?: string,
    transfer?: MobileTransfer,
  ) {
    if (!/^\/[a-zA-Z0-9][^\\]*$/.test(path) || path.startsWith('//') || path.includes('://'))
      throw new Error('请求路径无效');
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}/api${path}`, {
        method,
        credentials: 'omit',
        redirect: 'error',
        headers: {
          accept: transfer?.binary ? 'application/octet-stream' : 'application/json',
          ...(body !== undefined && !transfer?.multipart ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined
          ? { body: transfer?.multipart ? (body as FormData) : JSON.stringify(body) }
          : {}),
        signal: transferSignal(
          AbortSignal.timeout(
            method === 'POST' &&
              /^\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/submissions$/.test(path)
              ? 75000
              : method === 'POST' &&
                  /^\/mobile\/algorithms\/problems\/[A-Za-z0-9_-]{1,100}\/analysis$/.test(path)
                ? 195000
                : method === 'POST' &&
                    (path === '/mobile/ai-authoring/drafts' ||
                      /^\/mobile\/ai-study\/reports(?:\/[A-Za-z0-9_-]{1,100}\/search)?$/.test(path) ||
                      /^\/mobile\/programming\/projects\/[A-Za-z0-9_-]{1,100}\/ai-drafts$/.test(path))
                  ? 195000
                  : transfer
                    ? 60000
                    : 20000,
          ),
          transfer?.signal,
        ),
      });
    } catch {
      throw new MobileApiError(0, '无法连接平台，请检查地址、网络及服务器状态。');
    }
    if (response.ok && transfer?.binary) {
      const length = Number(response.headers.get('content-length'));
      if (
        !response.headers.has('content-length') ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > Math.min(50 * 1024 * 1024, transfer.maxBytes ?? 50 * 1024 * 1024)
      )
        throw new MobileApiError(502, '文件长度无效或超过手机端下载上限。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== length) throw new MobileApiError(502, '文件接收不完整，请重新下载。');
      if (transfer.metadata)
        return {
          bytes,
          contentType:
            response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ||
            'application/octet-stream',
          filename: mobileDownloadFilename(response.headers.get('content-disposition')),
        } satisfies MobileBinary;
      return bytes;
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
    return this.authenticate('/mobile/auth/login', {
      username: username.trim(),
      password,
      deviceName: '知学 Android',
    });
  }
  async refreshProfile() {
    const generation = this.generation;
    const { user } = await this.request<{ user: MobileUser }>('/mobile/auth/me');
    if (generation !== this.generation || !this.session) return;
    const prior = this.session.user;
    if (
      !user ||
      prior.id !== user.id ||
      prior.organizationId !== user.organizationId ||
      prior.role !== user.role ||
      prior.accountMode !== user.accountMode
    ) {
      await this.clear();
      throw new MobileApiError(401, '账号身份已变化，请重新登录');
    }
    this.session = { ...this.session, user };
    await this.save(this.session, generation);
    if (generation === this.generation) this.changed(user);
  }
  async register(input: { username: string; password: string; name: string }) {
    return this.authenticate('/mobile/auth/register', {
      username: input.username.trim(),
      name: input.name.trim(),
      password: input.password,
      deviceName: '知学 Android',
    });
  }
  async recover(input: { username: string; code: string; newPassword: string }) {
    const generation = this.generation;
    const result = await this.wire(
      '/mobile/auth/recover',
      { username: input.username.trim(), code: input.code.trim(), newPassword: input.newPassword },
      'POST',
    );
    if (generation !== this.generation) throw new MobileApiError(409, '登录身份已变化');
    if (result?.ok !== true || result?.loginRequired !== true)
      throw new MobileApiError(502, '服务器恢复响应格式无效');
    await this.clear();
  }
  private async authenticate(path: string, body: unknown) {
    this.invalidateResources();
    const generation = ++this.generation;
    this.session = null;
    this.changed(null);
    await this.save(null, generation);
    const data = await this.wire(path, body, 'POST');
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
  async switchRole(role: string) {
    const generation = this.generation;
    const data = await this.request('/mobile/auth/role', { role }, 'POST');
    if (generation !== this.generation) throw new MobileApiError(409, '登录身份已变化');
    if (
      !validSession(data) ||
      data.user.role !== role ||
      data.user.id !== this.session?.user.id ||
      data.user.organizationId !== this.session.user.organizationId
    )
      throw new MobileApiError(502, '服务器身份响应格式无效，请重新登录');
    this.invalidateResources();
    const next = ++this.generation;
    this.session = data;
    try {
      await this.save(data, next);
    } catch {
      await this.clear();
      throw new Error('无法安全保存新身份，请重新登录。');
    }
    if (next === this.generation) this.changed(data.user);
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
      if (generation === this.generation)
        for (const callback of this.accessListeners) {
          try {
            callback();
          } catch {}
        }
    })();
    this.refreshWork = work;
    try {
      await work;
    } finally {
      if (this.refreshWork === work) this.refreshWork = null;
    }
  }
  async request<T = any>(
    path: string,
    body?: unknown,
    method = 'GET',
    transfer?: MobileTransfer,
  ): Promise<T> {
    const generation = this.generation;
    if (!this.session) throw new MobileApiError(401, '请先登录');
    try {
      if (Date.parse(this.session.accessExpiresAt) <= Date.now() + 15000) await this.refresh(generation);
      const token = this.session!.accessToken;
      let result;
      try {
        result = await this.wire(path, body, method, token, transfer);
      } catch (error) {
        if (!(error instanceof MobileApiError) || error.status !== 401 || generation !== this.generation)
          throw error;
        if (this.session?.accessToken === token) await this.refresh(generation);
        result = await this.wire(path, body, method, this.session?.accessToken, transfer);
      }
      if (generation !== this.generation) throw new MobileApiError(409, '响应所属的登录身份已变化');
      return result;
    } catch (error) {
      if (generation === this.generation && error instanceof MobileApiError && error.status === 401)
        await this.clear();
      throw error;
    }
  }
  sessionEpoch() {
    return this.generation;
  }
  onAccessTokenChanged(callback: () => void) {
    this.accessListeners.add(callback);
    return () => {
      this.accessListeners.delete(callback);
    };
  }
  ownsSession(epoch: number) {
    return epoch === this.generation && this.session !== null;
  }
  uploadAssignmentFile<T>(assignmentId: string, body: FormData) {
    return this.request<T>(
      '/mobile/assignments/' + encodeURIComponent(assignmentId) + '/files',
      body,
      'POST',
      { multipart: true },
    );
  }
  downloadAssignmentFile(assignmentId: string, fileId: string) {
    return this.request<Uint8Array>(
      '/mobile/assignments/' + encodeURIComponent(assignmentId) + '/files/' + encodeURIComponent(fileId),
      undefined,
      'GET',
      { binary: true },
    );
  }
  download(path: string, options: { body?: unknown; method?: 'GET' | 'POST'; maxBytes?: number } = {}) {
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 50 * 1024 * 1024)
    )
      throw new Error('下载大小上限无效');
    return this.request<MobileBinary>(path, options.body, options.method || 'GET', {
      binary: true,
      metadata: true,
      maxBytes: options.maxBytes,
    });
  }
  async lessonVideoSource(lessonId: string, fileId: string) {
    if (![lessonId, fileId].every((id) => /^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new Error('视频标识无效');
    const generation = this.generation;
    const lesson = await this.request<{
      type: string;
      attachmentId: string | null;
      files: { id: string; mime: string }[];
    }>('/mobile/lessons/' + lessonId);
    if (
      lesson.type !== 'VIDEO' ||
      lesson.attachmentId !== fileId ||
      !lesson.files.some((file) => file.id === fileId && file.mime === 'video/mp4')
    )
      throw new Error('当前课时没有可播放的 MP4 视频');
    try {
      if (this.session && Date.parse(this.session.accessExpiresAt) <= Date.now() + 5 * 60000)
        await this.refresh(generation);
    } catch (e) {
      if (generation === this.generation && e instanceof MobileApiError && e.status === 401)
        await this.clear();
      throw e;
    }
    if (!this.ownsSession(generation)) throw new Error('登录身份已变化');
    return {
      uri: this.origin + '/api/mobile/lessons/' + lessonId + '/media/' + fileId,
      headers: { Authorization: 'Bearer ' + this.session!.accessToken },
      useCaching: false,
    };
  }
  async logout() {
    await this.request('/mobile/auth/logout', {}, 'POST');
    await this.clear();
  }
  async clear() {
    this.invalidateResources();
    const generation = ++this.generation;
    this.session = null;
    this.changed(null);
    await this.save(null, generation);
  }
}
