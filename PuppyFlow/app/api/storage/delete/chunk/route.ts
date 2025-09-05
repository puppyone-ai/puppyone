import { SERVER_ENV } from '@/lib/serverEnv';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

function filterRequestHeaders(headers: Headers): Record<string, string> {
  const newHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      [
        'host',
        'connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'encoding',
        'upgrade',
        'content-length',
        'cookie',
      ].includes(lower)
    ) {
      return;
    }
    newHeaders[key] = value;
  });

  // Storage expects Authorization, inject from cookie in cloud
  const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  if (mode === 'cloud') {
    try {
      const token = cookies().get('access_token')?.value;
      if (token) newHeaders['authorization'] = `Bearer ${token}`;
    } catch {}
  }
  // In local/dev, backend still requires presence of Authorization header.
  // Inject a harmless dev token so LocalAuthProvider accepts it.
  if (mode !== 'cloud' && !newHeaders['authorization']) {
    newHeaders['authorization'] = 'Bearer local-dev';
  }

  // Service-to-service key if configured
  if (SERVER_ENV.SERVICE_KEY) {
    newHeaders['x-service-key'] = SERVER_ENV.SERVICE_KEY;
  }

  return newHeaders;
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const blockId = searchParams.get('block_id');
    const fileName = searchParams.get('file_name');
    const versionId = searchParams.get('version_id');

    if (!blockId || !fileName || !versionId) {
      return new Response(
        JSON.stringify({
          error: 'MISSING_PARAMETERS',
          message: 'block_id, file_name, and version_id are required',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    // 获取用户ID - 通过调用用户系统API
    const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
    let userId = 'anonymous'; // 默认值

    if (mode === 'cloud') {
      try {
        // 云端模式：调用用户系统API获取用户ID
        const userResponse = await fetch(
          `${request.nextUrl.origin}/api/user-system/get_user_id`,
          {
            method: 'GET',
            headers: {
              Cookie: request.headers.get('cookie') || '',
            },
          }
        );

        if (userResponse.ok) {
          const userData = await userResponse.json();
          userId = userData.user_id || 'anonymous';
        }
      } catch (error) {
        console.warn('Failed to get user ID:', error);
      }
    } else {
      // 本地开发模式，使用固定用户ID
      userId = 'local-user';
    }

    // 构造完整的资源键：user_id/block_id/version_id/file_name
    const resourceKey = `${userId}/${blockId}/${versionId}/${fileName}`;

    console.log(`🔍 Constructed resource key: ${resourceKey}`);
    console.log(
      `🔍 Backend URL: ${SERVER_ENV.PUPPY_STORAGE_BACKEND}/files/delete`
    );
    console.log(`🔍 Request payload:`, {
      user_id: userId,
      resource_key: resourceKey,
    });

    // 调用后端的删除API
    const backendUrl = `${SERVER_ENV.PUPPY_STORAGE_BACKEND}/files/delete`;
    const headers = filterRequestHeaders(request.headers);

    const deleteResponse = await fetch(backendUrl, {
      method: 'DELETE',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        resource_key: resourceKey,
      }),
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      return new Response(
        JSON.stringify({
          error: 'DELETE_FAILED',
          message: `Backend delete failed: ${deleteResponse.status} ${errorText}`,
        }),
        {
          status: deleteResponse.status,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    const result = await deleteResponse.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Delete chunk error:', err);
    return new Response(
      JSON.stringify({
        error: 'DELETE_CHUNK_ERROR',
        message: err?.message || 'delete chunk failed',
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
