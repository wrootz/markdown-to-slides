// server.js

// Importa os módulos necessários
const express = require('express'); // Framework web para Node.js
const path = require('path');     // Utilitário para lidar com caminhos de arquivo e diretório
const { google } = require('googleapis'); // Biblioteca cliente oficial do Google para Node.js
const markdownit = require('markdown-it')(); // Parser de Markdown
const dotenv = require('dotenv'); // Para carregar variáveis de ambiente do arquivo .env

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

// Inicializa a aplicação Express
const app = express();
const port = process.env.PORT || 3000; // Define a porta do servidor, usando 3000 como padrão

// --- Configuração do Express ---

// Serve arquivos estáticos (CSS, imagens, JavaScript do frontend) da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));
// Middleware para analisar corpos de requisição URL-encoded (vindos de formulários HTML)
app.use(express.urlencoded({ extended: true }));
// Configura o EJS como o motor de template para renderizar as views
app.set('view engine', 'ejs');
// Define o diretório onde os arquivos EJS (templates) estão localizados
app.set('views', path.join(__dirname, 'views'));

// --- Configuração OAuth2 para a Google API ---

// Cria uma nova instância do cliente OAuth2 do Google
// As credenciais são carregadas das variáveis de ambiente para segurança
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,        // Seu ID do Cliente Google
  process.env.GOOGLE_ENV_CLIENT_SECRET, // Seu Segredo do Cliente Google
  process.env.GOOGLE_REDIRECT_URI      // URI de redirecionamento configurada no Google Cloud Console
);

// --- Rotas da Aplicação ---

// Rota para iniciar o processo de autenticação com o Google
app.get('/auth/google', (req, res) => {
  // Define os escopos (permissões) que a aplicação solicita ao Google
  // 'presentations' para criar/gerenciar apresentações, 'drive' para gerenciar arquivos no Drive
  const scopes = [
    'https://www.googleapis.com/auth/presentations',
    'https://www.googleapis.com/auth/drive'
  ];
  // Gera a URL de autorização do Google
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Solicita um refresh token, permitindo que a aplicação acesse a API mesmo quando o usuário não está online
    scope: scopes,          // Escopos definidos acima
    prompt: 'consent'       // Garante que o usuário sempre veja a tela de consentimento para fornecer um refresh token
  });
  // Redireciona o navegador do usuário para a URL de autenticação do Google
  res.redirect(url);
});

// Rota de callback após o Google autenticar o usuário e redirecioná-lo de volta
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query; // Extrai o código de autorização da query string da URL
  try {
    // Troca o código de autorização por tokens de acesso (access_token e refresh_token)
    const { tokens } = await oauth2Client.getToken(code);
    // Define as credenciais (tokens) para o cliente OAuth2, que serão usadas em requisições futuras
    oauth2Client.setCredentials(tokens);
    // Redireciona o usuário de volta para a página inicial da aplicação após a autenticação
    res.redirect('/');
  } catch (error) {
    console.error('Erro ao obter tokens de acesso:', error);
    res.status(500).send('Erro na autenticação com o Google.');
  }
});

// Rota da página inicial da aplicação
app.get('/', (req, res) => {
  // Verifica se o usuário já está autenticado (se há um access_token nas credenciais)
  const isAuthenticated = !!oauth2Client.credentials.access_token;
  // Renderiza a página 'index.ejs', passando a informação de autenticação para o frontend
  res.render('index', { isAuthenticated });
});

// Rota para processar a conversão de Markdown para Google Slides
app.post('/convert', async (req, res) => {
  const { markdownText } = req.body; // Extrai o texto Markdown enviado pelo formulário

  // Verifica se o usuário está autenticado antes de tentar criar a apresentação
  if (!oauth2Client.credentials.access_token) {
    return res.status(401).send('Por favor, autentique-se com o Google primeiro através do botão de login na página inicial.');
  }

  // Divide o texto Markdown em slides, usando "---" como delimitador.
  // Remove espaços em branco extras e filtra strings vazias.
  const slidesContent = markdownText.split('---').map(s => s.trim()).filter(Boolean);

  // Inicializa o serviço da Google Slides API com o cliente OAuth2 autenticado
  const slidesApi = google.slides({ version: 'v1', auth: oauth2Client });

  try {
    // 1. Cria uma nova apresentação vazia no Google Slides
    const presentation = await slidesApi.presentations.create({
      requestBody: {
        title: 'Apresentação Gerada do Markdown', // Título padrão para a nova apresentação
      },
    });
    const presentationId = presentation.data.presentationId; // ID da apresentação recém-criada

    const requests = []; // Array para armazenar todas as requisições em lote para a API
    let slideCount = 0; // Contador de slides

    // Itera sobre cada bloco de conteúdo Markdown que representa um slide
    for (const slideMd of slidesContent) {
      // Analisa o conteúdo Markdown do slide em uma árvore de tokens (AST)
      const tokens = markdownit.parse(slideMd, {});
      let slideTitle = ''; // Variável para armazenar o título do slide
      let slideBodyElements = []; // Array para armazenar o conteúdo do corpo do slide

      // Itera sobre os tokens para extrair título e corpo do slide
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === 'heading_open') {
          // Se o token for a abertura de um cabeçalho (h1, h2, etc.)
          const nextToken = tokens[i + 1]; // O conteúdo do cabeçalho está no próximo token inline
          if (nextToken && nextToken.type === 'inline') {
            slideTitle = nextToken.content; // Define o título do slide
            i++; // Avanza o índice para pular o token inline já processado
          }
        } else if (token.type === 'paragraph_open' || token.type === 'list_item_open') {
          // Se o token for a abertura de um parágrafo ou item de lista
          const nextToken = tokens[i + 1]; // O conteúdo está no próximo token inline
          if (nextToken && nextToken.type === 'inline') {
            let content = nextToken.content;
            if (token.type === 'list_item_open') {
              // Para itens de lista, adiciona um caractere de bullet simples
              content = '• ' + content;
            }
            slideBodyElements.push(content); // Adiciona o conteúdo ao corpo do slide
            i++; // Avança o índice para pular o token inline
          }
        }
        // Outros tipos de tokens (bold, italic, code blocks, etc.) precisariam de lógica
        // mais avançada e requisições específicas da API para serem formatados.
        // Nesta implementação simplificada, eles são ignorados ou tratados como texto plano.
      }

      // Adiciona uma nova página (slide) à apresentação
      const slideObjectId = `slide_${Date.now()}_${slideCount}`; // ID único para o novo slide
      requests.push({
        createSlide: {
          objectId: slideObjectId,
          insertionIndex: slideCount, // Posição do slide na apresentação
          // CORREÇÃO: Usar slideLayoutReference em vez de slideProperties
          slideLayoutReference: {
            predefinedLayout: 'TITLE_AND_BODY' // Usa o layout predefinido TITLE_AND_BODY
          }
        }
      });

      // --- Adiciona a caixa de texto para o TÍTULO do slide ---
      const titleShapeObjectId = `title_shape_${Date.now()}_${slideCount}`; // ID único para a caixa de título
      requests.push({
        createShape: {
          objectId: titleShapeObjectId,
          shapeType: 'TEXT_BOX', // Tipo da forma é uma caixa de texto
          elementProperties: {
            pageObjectId: slideObjectId, // Associa a caixa de texto ao slide recém-criado
            transform: {
              scaleX: 1, // CORREÇÃO: Adicionado scaleX
              scaleY: 1, // CORREÇÃO: Adicionado scaleY
              translateX: 50,
              translateY: 50,
              unit: 'PT'
            },
            size: {
              width: {
                magnitude: 600,
                unit: 'PT'
              },
              height: {
                magnitude: 50,
                unit: 'PT'
              }
            }
          }
        }
      });
      // Insere o texto do título na caixa de texto criada
      requests.push({
        insertText: {
          objectId: titleShapeObjectId,
          text: slideTitle || 'Slide ' + (slideCount + 1)
        }
      });
      // Aplica estilo ao texto do título (negrito, tamanho da fonte)
      requests.push({
        updateTextStyle: {
            objectId: titleShapeObjectId,
            textRange: { type: 'ALL' },
            style: {
                fontSize: { magnitude: 24, unit: 'PT' },
                bold: true
            },
            fields: 'fontSize,bold'
        }
      });

      // --- Adiciona a caixa de texto para o CORPO do slide ---
      const bodyShapeObjectId = `body_shape_${Date.now()}_${slideCount}`; // ID único para a caixa do corpo
      requests.push({
        createShape: {
          objectId: bodyShapeObjectId,
          shapeType: 'TEXT_BOX',
          elementProperties: {
            pageObjectId: slideObjectId,
            transform: {
              scaleX: 1, // CORREÇÃO: Adicionado scaleX
              scaleY: 1, // CORREÇÃO: Adicionado scaleY
              translateX: 50,
              translateY: 120,
              unit: 'PT'
            },
            size: {
              width: {
                magnitude: 600,
                unit: 'PT'
              },
              height: {
                magnitude: 350,
                unit: 'PT'
              }
            }
          }
        }
      });
      // Insere o texto do corpo na caixa de texto criada
      requests.push({
        insertText: {
          objectId: bodyShapeObjectId,
          text: slideBodyElements.join('\n\n')
        }
      });
      // Aplica estilo ao texto do corpo (tamanho da fonte)
      requests.push({
        updateTextStyle: {
            objectId: bodyShapeObjectId,
            textRange: { type: 'ALL' },
            style: {
                fontSize: { magnitude: 14, unit: 'PT' }
            },
            fields: 'fontSize'
        }
      });

      slideCount++;
    }

    // Executa todas as requisições de criação e atualização em lote (otimiza chamadas à API)
    if (requests.length > 0) {
      await slidesApi.presentations.batchUpdate({
        presentationId,
        requestBody: { requests },
      });
    }

    // Constrói a URL da apresentação recém-criada no Google Slides
    const presentationUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
    // Redireciona o usuário para a página de sucesso, passando a URL da apresentação
    res.render('success', { presentationUrl });

  } catch (error) {
    console.error('Erro ao converter Markdown para slides:', error);
    // Mensagens de erro mais úteis para o usuário
    if (error.code === 400 && error.message.includes("LAYOUT_NOT_FOUND")) {
      res.status(500).send('Erro: O layout de slide "TITLE_AND_BODY" pode não estar disponível ou houve um problema na criação do slide. Verifique as permissões da API e tente novamente.');
    } else if (error.code === 401) {
      res.status(401).send('Erro de autenticação: Suas credenciais podem estar expiradas ou inválidas. Por favor, tente fazer login novamente com o Google.');
    } else {
      res.status(500).send(`Ocorreu um erro inesperado ao converter o Markdown para slides: ${error.message || error}`);
    }
  }
});

// Inicia o servidor Express na porta definida
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});