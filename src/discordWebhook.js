'use strict';

/**
 * Discord #mod-logs webhook.
 *
 * Staff paste a Discord channel webhook URL on /staff.html (stored in
 * server_settings as `discord_modlog_webhook`; only owner/admin can set or
 * clear it). Every audit entry written by logAudit() is then mirrored to that
 * channel as a rich embed — no Discord bot needed, just an HTTPS POST.
 *
 * Posting is fire-and-forget with a short timeout: a dead or slow webhook
 * must never delay or break the staff action that triggered it.
 */

const { getSetting, setSetting } = require('./db');

const SETTING_KEY = 'discord_modlog_webhook';
const TIMEOUT_MS = 6000;

function isValidWebhookUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const hostOk =
      u.hostname === 'discord.com' || u.hostname.endsWith('.discord.com') ||
      u.hostname === 'discordapp.com' || u.hostname.endsWith('.discordapp.com');
    return u.protocol === 'https:' && hostOk && u.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

async function getWebhookUrl() {
  try {
    return (await getSetting(SETTING_KEY)) || '';
  } catch {
    return '';
  }
}

async function setWebhookUrl(url) {
  const clean = String(url || '').trim();
  if (clean && !isValidWebhookUrl(clean)) {
    const err = new Error('That does not look like a Discord webhook URL.');
    err.code = 'bad-url';
    throw err;
  }
  await setSetting(SETTING_KEY, clean);
  return clean;
}

// Masked for display on the staff page: never leak the token part.
function maskWebhookUrl(url) {
  const m = String(url || '').match(/^(https:\/\/[^/]+\/api\/webhooks\/)(\d+)\/(.+)$/);
  if (!m) return '';
  const token = m[3];
  return `${m[1]}${m[2].slice(0, 4)}…/${token.slice(0, 2)}…${token.slice(-2)}`;
}

function actionEmoji(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('ban')) return a.includes('un') ? '🔓' : '🔨';
  if (a.includes('kick')) return '👢';
  if (a.includes('mute')) return a.includes('un') ? '🔊' : '🔇';
  if (a.includes('grant')) return '🎁';
  if (a.includes('warn')) return '⚠️';
  return '🛡️';
}

// Mirror one audit entry to the configured Discord channel.
// Never rejects; never throws.
function postModlog(entry) {
  return (async () => {
    const url = await getWebhookUrl();
    if (!url) return;
    const e = entry || {};
    const body = {
      embeds: [
        {
          title: `${actionEmoji(e.action)} ${e.action || 'staff action'}`,
          color: 0x9b30ff, // shadow purple
          fields: [
            { name: 'Staff', value: String(e.actor || '?').slice(0, 100), inline: true },
            { name: 'Role', value: String(e.actorRole || '?').slice(0, 50), inline: true },
            { name: 'Target', value: String(e.target || '—').slice(0, 100), inline: true },
          ],
          timestamp: new Date(Number(e.ts) || Date.now()).toISOString(),
          footer: { text: 'Throne of Shadows — staff audit' },
        },
      ],
    };
    if (e.detail) {
      body.embeds[0].fields.push({
        name: 'Detail',
        value: String(e.detail).slice(0, 1000),
      });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) console.warn('[modlog] Discord webhook POST failed:', res.status);
    } catch (err) {
      console.warn('[modlog] Discord webhook error:', err && err.message);
    } finally {
      clearTimeout(timer);
    }
  })().catch(() => {});
}

module.exports = {
  getWebhookUrl,
  setWebhookUrl,
  maskWebhookUrl,
  isValidWebhookUrl,
  postModlog,
};
