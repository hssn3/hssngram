let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const data = (await response.json()) as { accessToken: string };
        accessToken = data.accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
  skipAuthRetry?: boolean;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (response.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...options, skipAuthRetry: true });
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(data.error ?? 'request_failed'),
      String(data.message ?? 'درخواست انجام نشد'),
      data.details,
    );
  }

  return data as T;
}

export async function bootstrapSession(): Promise<boolean> {
  return refreshSession();
}

export type UploadInit = {
  id: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  maxSize: number;
};

export function uploadFile(
  file: File,
  options: { kind?: 'voice'; duration?: number } = {},
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const init = async () => {
      try {
        const created = await api<UploadInit>('/uploads/init', {
          method: 'POST',
          body: {
            name: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size,
            kind: options.kind,
            duration: options.duration,
          },
        });

        const xhr = new XMLHttpRequest();
        xhr.open(created.method, created.uploadUrl, true);
        for (const [key, value] of Object.entries(created.headers)) {
          if (key.toLowerCase() === 'content-type' && created.uploadUrl.startsWith('/api/uploads/local')) {
            continue;
          }
          xhr.setRequestHeader(key, value);
        }
        if (accessToken) xhr.setRequestHeader('authorization', `Bearer ${accessToken}`);
        if (created.uploadUrl.startsWith('/api/uploads/local')) {
          xhr.setRequestHeader('content-type', 'application/octet-stream');
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            // Progress events are consumed by the caller through the returned object if needed.
          }
        };

        xhr.onload = async () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new ApiError(xhr.status, 'upload_failed', 'بارگذاری فایل ناموفق بود'));
            return;
          }
          try {
            const completed = await api<{ attachment: { id: string } }>(
              `/uploads/${created.id}/complete`,
              { method: 'POST' },
            );
            resolve(completed.attachment);
          } catch (error) {
            reject(error);
          }
        };

        xhr.onerror = () => reject(new ApiError(0, 'network', 'خطای شبکه در بارگذاری فایل'));
        xhr.send(file);
      } catch (error) {
        reject(error);
      }
    };

    void init();
  });
}
