const express = require('express');
const session = require('express-session');
const cors = require('cors');
const OpenAI = require('openai');
const crypto = require('node:crypto');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendUrl = process.env.FRONTEND_URL;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.set('trust proxy', 1);
app.use(cors({ origin: frontendUrl || true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'linkedin.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 }
}));

function requireLinkedInSession(req, res, next) {
  if (!req.session.linkedin) return res.status(401).json({ error: 'Autentique-se primeiro em /auth/linkedin.' });
  next();
}

function linkedinHeaders(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'LinkedIn-Version': process.env.LINKEDIN_VERSION || '202501',
    'X-Restli-Protocol-Version': '2.0.0'
  };
}

async function linkedinFetch(path, options = {}) {
  const response = await fetch(`https://api.linkedin.com${path}`, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`LinkedIn API error (${response.status})`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'linkedin-ai-integration' }));

app.get('/auth/linkedin', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    state,
    scope: 'openid profile email w_member_social'
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

app.get('/auth/linkedin/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) return res.status(400).json({ error, error_description: errorDescription });
  if (!code || !state || state !== req.session.oauthState) return res.status(400).json({ error: 'OAuth state inválido.' });
  delete req.session.oauthState;

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET
    });
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok) return res.status(tokenResponse.status).json({ error: 'Falha ao obter token do LinkedIn.', details: token });

    const profile = await linkedinFetch('/v2/userinfo', { headers: linkedinHeaders(token.access_token) });
    req.session.linkedin = { accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in || 0) * 1000, profile };
    res.redirect(frontendUrl || '/api/profile');
  } catch (error) {
    res.status(error.status || 500).json({ error: 'Falha na autenticação.', details: error.details || error.message });
  }
});

app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/profile', requireLinkedInSession, (req, res) => res.json(req.session.linkedin.profile));

app.post('/api/posts', requireLinkedInSession, async (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content || content.length > 3000) return res.status(400).json({ error: 'content é obrigatório e deve ter até 3000 caracteres.' });
  const { accessToken, profile } = req.session.linkedin;
  try {
    const post = await linkedinFetch('/rest/posts', {
      method: 'POST', headers: linkedinHeaders(accessToken, true),
      body: JSON.stringify({
        author: `urn:li:person:${profile.sub}`,
        commentary: content,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
      })
    });
    res.status(201).json({ ok: true, post });
  } catch (error) {
    res.status(error.status || 500).json({ error: 'Não foi possível publicar no LinkedIn.', details: error.details || error.message });
  }
});

app.post('/api/network-analysis', requireLinkedInSession, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY não configurada.' });
  const connections = req.body.connections;
  if (!Array.isArray(connections) || connections.length === 0) return res.status(400).json({ error: 'Envie connections como um array exportado pelo usuário.' });
  if (connections.length > 500) return res.status(400).json({ error: 'Envie no máximo 500 conexões por análise.' });

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Você é um especialista em networking. Não invente dados e não recomende spam. Retorne JSON com as chaves resumo, segmentos, oportunidades e proximas_acoes.' },
        { role: 'user', content: JSON.stringify({ instrucoes: 'Analise padrões profissionais, setores e oportunidades de relacionamento com base somente nos dados fornecidos. Anonimize nomes quando possível.', connections }) }
      ]
    });
    res.json({ ok: true, analysis: JSON.parse(completion.choices[0].message.content) });
  } catch (error) {
    res.status(500).json({ error: 'Falha na análise com IA.', details: error.message });
  }
});

app.use((error, _req, res, _next) => res.status(500).json({ error: 'Erro interno.', details: error.message }));
app.listen(port, () => console.log(`API disponível em http://localhost:${port}`));