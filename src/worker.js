const COOKIE_NAME = 'qaiora_session';
const SESSION_SECONDS = 60 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createCookieValue(userId, expiresAt, secret) {
  const payload = b64url(new TextEncoder().encode(`${userId}.${expiresAt}`));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload))
  );
  return `${payload}.${b64url(signature)}`;
}

async function validCookie(request, secret) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.split(';')
    .map(x => x.trim())
    .find(x => x.startsWith(`${COOKIE_NAME}=`));

  if (!match) return false;

  const value = match.slice(COOKIE_NAME.length + 1);
  const parts = value.split('.');
  if (parts.length !== 2) return false;

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromB64url(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!valid) return false;

    const decoded = new TextDecoder().decode(fromB64url(parts[0]));
    const separator = decoded.lastIndexOf('.');
    if (separator < 1) return false;

    const userId = decoded.slice(0, separator);
    const expiresAtText = decoded.slice(separator + 1);
    const expiresAt = Number(expiresAtText);

    return Boolean(userId) &&
      /^\\d+$/.test(expiresAtText) &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function serveAsset(env, pathname, request) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health') {
      return new Response('QAIORA worker is running', {
        headers: { 'cache-control': 'no-store' }
      });
    }

    // Login page is public; all application assets remain protected below.
    if (path === '/login' || path === '/login/') {
      return serveAsset(env, '/login.html', request);
    }

    if (path === '/auth/session' && request.method === 'POST') {
      const authorization = request.headers.get('Authorization') || '';
      const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

      if (!accessToken) return json({ error: 'Missing access token' }, 401);
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SESSION_SECRET) {
        return json({ error: 'Authentication is not configured' }, 503);
      }

      let verifyResponse;
      try {
        verifyResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: {
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken}`
          }
        });
      } catch {
        return json({ error: 'Authentication service is unavailable' }, 502);
      }

      if (!verifyResponse.ok) return json({ error: 'Invalid or expired session' }, 401);

      const user = await verifyResponse.json();
      if (!user || !user.id) return json({ error: 'Invalid user session' }, 401);

      const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      const value = await createCookieValue(user.id, expiresAt, env.SESSION_SECRET);

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'set-cookie': `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`
        }
      });
    }

    if (path === '/auth/logout' && request.method === 'POST') {
      return new Response(null, {
        status: 204,
        headers: {
          'set-cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
          'cache-control': 'no-store'
        }
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const authenticated = Boolean(
      env.SESSION_SECRET && await validCookie(request, env.SESSION_SECRET)
    );

    if (!authenticated) {
      return Response.redirect(new URL('/login', request.url), 302);
    }

    return env.ASSETS.fetch(request);
  }
};
