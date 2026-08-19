export async function postXiaoaiAnnounce({
  enabled,
  homepageBaseUrl,
  homepagePetToken,
  text,
} = {}) {
  if (!enabled) return { ok: true, skipped: true, error: null };
  const base = String(homepageBaseUrl || '').replace(/\/+$/, '');
  const token = String(homepagePetToken || '').trim();
  const payload = String(text || '').trim();
  if (!base || !token) return { ok: false, skipped: true, error: 'homepage 未配置' };
  if (!payload) return { ok: false, skipped: true, error: 'empty text' };
  try {
    const res = await fetch(base + '/api/xiaomi/pet-announce', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-Pet-Token': token,
      },
      body: JSON.stringify({ text: payload, kind: 'workpet' }),
    });
    if (!res.ok) {
      return { ok: false, skipped: false, error: 'HTTP ' + res.status };
    }
    return { ok: true, skipped: false, error: null };
  } catch (err) {
    return { ok: false, skipped: false, error: err.message || 'network' };
  }
}
