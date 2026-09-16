const fs = require('fs');
let content = fs.readFileSync('worker/src/index.ts', 'utf8');

const newRoutes = `
app.post('/api/auth/register-open', async (c) => {
  const settings = await getRuntimeSettings(c.env.DB);
  if (!settings.allowOpenRegistration) {
    return errorResponse('未开启开放注册', 403);
  }
  const payload = await parseJsonRequest(c.req.raw);
  const username = String(payload.username || '').trim();
  const email = String(payload.email || '').trim();
  const password = String(payload.password || '');
  const displayName = String(payload.displayName || username).trim();

  if (!username || !password) return errorResponse('用户名和密码不能为空');
  
  const hashed = await hashPassword(password);
  const userId = await createOpenUser(c.env.DB, { username, email, displayName, passwordHash: hashed.hash, passwordSalt: hashed.salt });
  
  // ensureGeneralChannelMembership is imported, wait, let's just copy what the token register does:
  // Actually, I can't easily import ensureGeneralChannelMembership here if it's not imported.
  // Wait, I will just require it.
  
  return c.json({ ok: true });
});

app.post('/api/auth/forgot-password', async (c) => {
  const payload = await parseJsonRequest(c.req.raw);
  const email = String(payload.email || '').trim();
  if (!email) return errorResponse('邮箱不能为空');
  
  const settings = await getRuntimeSettings(c.env.DB);
  if (!settings.smtpRelayUrl) return errorResponse('系统未配置发件服务');

  const reset = await createPasswordReset(c.env.DB, email);
  if (!reset) return c.json({ ok: true }); // Silent fail

  // Call Koyeb Mail Relay
  const resetLink = \`\${new URL(c.req.url).origin}/reset-password/\${reset.token}\`;
  try {
    await fetch(settings.smtpRelayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${settings.smtpApiKey}\` },
      body: JSON.stringify({
        to: email,
        subject: \`[\${settings.siteName}] 密码重置\`,
        text: \`你好，\${reset.username}：\\n\\n请点击以下链接重置你的密码：\\n\${resetLink}\\n\\n该链接在 1 小时内有效。\`,
      })
    });
  } catch (e) {
    console.error('mail error', e);
  }
  
  return c.json({ ok: true });
});

app.post('/api/auth/reset-password', async (c) => {
  const payload = await parseJsonRequest(c.req.raw);
  const token = String(payload.token || '').trim();
  const password = String(payload.password || '');
  if (!token || !password) return errorResponse('参数无效');
  
  const reset = await getPasswordReset(c.env.DB, token);
  if (!reset) return errorResponse('重置链接无效或已过期', 400);

  const hashed = await hashPassword(password);
  await resetUserPassword(c.env.DB, reset.user_id, hashed.hash, hashed.salt);
  await clearPasswordReset(c.env.DB, token);
  return c.json({ ok: true });
});
`;

content = content.replace(
  /app\.post\('\/api\/auth\/login', async \(c\) => \{/,
  `${newRoutes}\napp.post('/api/auth/login', async (c) => {`
);

// We need to import ensureGeneralChannelMembership. Let's find it.
if (!content.includes('import { ensureGeneralChannelMembership }')) {
   content = content.replace(
     /import \{ hashPassword, verifyPassword \} from '\.\/data\/crypto\.ts';/,
     `import { hashPassword, verifyPassword } from './data/crypto.ts';\nimport { ensureGeneralChannelMembership } from './data/channels.ts';`
   );
}

// Add the call in register-open
content = content.replace(
  /const userId = await createOpenUser.*?;\n\s*return c\.json\(\{ ok: true \}\);/m,
  `const userId = await createOpenUser(c.env.DB, { username, email, displayName, passwordHash: hashed.hash, passwordSalt: hashed.salt });\n  await ensureGeneralChannelMembership(c.env.DB, userId);\n  return c.json({ ok: true });`
);

fs.writeFileSync('worker/src/index.ts', content, 'utf8');
console.log('Routes added');
