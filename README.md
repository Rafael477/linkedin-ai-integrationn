 

# LinkedIn AI Integration

Integração da API do LinkedIn com Inteligência Artificial.

## Funcionalidades

- Autenticação OAuth 2.0 com LinkedIn
- Leitura de perfil do usuário
- Publicação automática de conteúdo
- Análise de rede com IA

## Requisitos

- Node.js 20+
- Conta no LinkedIn Developers
- Chave da API OpenAI

## Instalação

1. Clone o repositório
2. Instale as dependências: npm install
3. Configure o arquivo .env com suas credenciais
4. Inicie o servidor: npm run dev

## Variáveis de Ambiente

LINKEDIN_CLIENT_ID=seu_id
LINKEDIN_CLIENT_SECRET=seu_secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/auth/linkedin/callback
OPENAI_API_KEY=sua_chave

## API Endpoints

GET /auth/linkedin - Iniciar login
GET /api/profile - Obter perfil
POST /api/posts - Publicar conteúdo
POST /api/network-analysis - Analisar rede
POST /auth/logout - Fazer logout

## Licença

MIT