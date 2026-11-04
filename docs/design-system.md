# Identidade visual e design system — Clinni

A interface aplica a identidade da Clinni definida na pasta `vsmidia` (direção C, “Contínuo”). As pranchas cobrem o conceito, o logotipo, as cores, a tipografia, os componentes, o dashboard claro e escuro, as aplicações e o social. Este documento explica como a identidade virou código, quais decisões cobriram o que o manual não define e o que já está pronto, só na interface, para várias clínicas.

## Onde está cada coisa

| O quê | Arquivo |
| --- | --- |
| Tokens (cores, tipografia, raios, elevação, movimento), temas claro e escuro | `src/app/globals.css` |
| Logotipo, símbolo e marca da clínica | `src/components/brand/clinni-logo.tsx` |
| Arquivos oficiais da marca (SVG) | `docs/brand/` |
| Favicon e ícone do iOS | `src/app/icon.svg`, `src/app/apple-icon.png` |
| Fonte, metadados, cor da barra do navegador, script de tema | `src/app/layout.tsx` |
| Preferência de tema e seletor | `src/components/theme/theme.ts`, `theme-toggle.tsx` |
| Clínica ativa (espaço de trabalho) | `src/server/queries/clinic.ts`, `src/components/layout/workspace-switcher.tsx` |
| Combinação de classes (`cn`) | `src/lib/utils.ts` |

## Marca

O símbolo é um arco de 278° com um ponto: o arco representa o relacionamento contínuo com a paciente, e o ponto, o contato humano. O desenho vem dos SVGs oficiais, sem redesenho.

- `ClinniLogo` tem duas variantes. `variant="regular"` (padrão) é a versão horizontal. `variant="compact"` é a versão para alturas abaixo de 24 px.
- `tone="auto"` usa a tinta e o damasco do tema atual. `tone="inverse"` serve para fundos tinta, como o painel do login.
- `ClinniSymbol` é só o símbolo. Aparece na barra lateral recolhida.
- `ClinicMark` mostra as iniciais da clínica sobre a superfície tinta e ocupa o lugar do logotipo da clínica até existir upload (ver [Preparação multi-clínica](#preparação-multi-clínica-somente-interface)).

Regras do manual aplicadas:

- A versão compacta é usada abaixo de 24 px de altura.
- A área de proteção é igual à altura-x.
- Tamanhos mínimos: horizontal 108 px, principal 72 px, compacta 64 px, símbolo e favicon 16 px.
- O logotipo é preenchido só com os tokens `brand-ink`/`brand-dot`: nada de cores livres, sombras ou efeitos.

Os 12 arquivos de `docs/brand/` são:

- Versões horizontal, principal e símbolo, cada uma também na variante de fundo escuro.
- Compacta.
- Monocromáticas em tinta, branco e preto.
- Ícone de app.
- Favicon.

Ficam em `docs/` e não em `public/` porque o `proxy.ts` exige login para tudo que o *matcher* não exclui. Publicá-los exigiria mexer na autenticação, o que está fora do escopo desta etapa.

## Cores

Os tokens são **semânticos**: o nome diz para que serve, não qual é o matiz. As cores da marca são:

- **Tinta** `#1a2050`: marca.
- **Íris** `#4a56c4`: ação.
- **Damasco** `#e58a60`: o ponto humano.
- **Porcelana** `#fcfbf9`: fundo.
- **Grafite** `#13110f`: texto.

| Token | Claro | Escuro (Noite) | Uso |
| --- | --- | --- | --- |
| `background` / `foreground` | `#fcfbf9` / `#13110f` | `#0f1117` / `#f4f5f9` | Página e texto |
| `card`, `popover` | `#ffffff` | `#161820`, `#1d1f27` | Painéis, menus |
| `muted` / `muted-foreground` | `#f1efed` / `#67625e` | `#1d1f27` / `#afb2bd` | Áreas neutras, texto secundário |
| `border`, `input`, `ring` | `#dfdcd8`, `#918d88`, `#6272df` | `#2c2f39`, `#6f727f`, `#b0bffd` | Divisões, borda de campo, foco |
| `primary` / `primary-subtle` | `#4a56c4` / `#f4f6fe` | `#8597f2` / `#282c42` | Ação principal, seleção, item ativo |
| `brand-ink`, `brand-dot` | `#1a2050`, `#e58a60` | `#f8f6f4`, `#f39e77` | Logotipo |
| `brand-surface` | `#1a2050` | (igual) | Painel de marca do login, `ClinicMark` |
| `success`, `warning`, `info`, `destructive` (+ `-subtle`) | `#197746`, `#94610e`, `#036c9c`, `#c72d31` | `#65c98c`, `#faba59`, `#64bced`, `#f67972` | Estados |
| `insight` (+ `-subtle`) | `#a45631` | `#f39e77` | Exclusivo do assistente / IA |
| `chart-1` … `chart-6` | rampa da prancha do dashboard | idem, ajustada | Gráficos |
| `sidebar`, `nav-active` | `#f8f6f4`, `#e8edff` | `#0a0b11`, `#282c42` | Navegação |

Regras de uso:

- **O damasco aparece no máximo uma vez por tela e nunca indica status.** Fora do logotipo, ele só marca o assistente (token `insight`). Por isso o estado vazio usa o ponto em Íris.
- Os estados combinam cor com texto, ponto ou ícone, nunca só a cor. `StatusBadge` tem os tons `neutral`, `primary`, `warning`, `info`, `success`, `danger` e `muted`.
- **Contraste medido:** todos os pares de texto/fundo passam no WCAG AA (≥ 4,5:1) nos dois temas. O menor valor é `warning` sobre `warning-subtle` no tema claro, com 4,90:1. Bordas de campo e anel de foco ficam ≥ 3:1.

Os tokens antigos, nomeados por matiz, foram migrados nos componentes conforme a tabela abaixo. Ela é útil para ramos pendentes:

| Antes | Depois |
| --- | --- |
| `rose` | `primary` |
| `brick` | `destructive` (tom `danger`) |
| `champagne` | `warning` |
| `lavender` | `info` |
| `sage` | `success` |
| `surface-raised` | `muted` |
| `onyx` | `brand-surface` |
| `chart-accent` | `chart-1` |

## Tipografia

A fonte é Manrope, via `next/font`: o arquivo é baixado no build e servido pelo próprio app, sem requisição ao Google em tempo de execução. A interface usa quatro pesos (400, 500, 600, 700). A escala é registrada no tema do Tailwind:

| Classe | Tamanho / entrelinha | Peso | Uso |
| --- | --- | --- | --- |
| `text-display` | 56 / 60 px, −0,03em | 600 | Mensagem do login (com `clamp`) |
| `text-title-1` | 28 / 36 px, −0,02em | 600 | Título de página (≥ 640 px; 24 px no celular) |
| `text-title-2` | 20 / 28 px, −0,01em | 600 | Títulos de seção e de ficha |
| `text-title-3` | 16 / 24 px | 600 | Títulos de painel |
| `text-metric` | 30 / 36 px, −0,02em | 600 | Números de indicadores (com `tabular-nums`) |
| `text-overline` | 11 / 16 px, +0,08em | 600 | Sobretítulos (com `uppercase`) |

O corpo usa a escala padrão: 14 px (`text-sm`) para conteúdo e 12 px (`text-xs`) para metadados.

> **Atenção ao `cn()`.** O tailwind-merge não conhece essa escala por padrão. Sem configuração, ele tratava `text-metric` como cor e o descartava ao lado de `text-destructive`. A escala está declarada em `extendTailwindMerge` (`src/lib/utils.ts`). **Um tamanho novo precisa entrar nos dois lugares:** `globals.css` e `utils.ts`.

## Forma, espaço, elevação e movimento

- **Raios:**
  - 6 px (`rounded-sm`)
  - 8 px (`md`)
  - 10 px (`lg`): campos e botões
  - 14 px (`xl`): painéis e cartões
  - 18 px (`2xl`): diálogos
  - `rounded-full`: selos
- **Superfícies** se separam por tom e borda. **Sombra só em elementos flutuantes e modais**, em três níveis com subtom grafite:
  - `elevation-1`: reservado, ainda sem uso
  - `elevation-2`: menus, toasts, ação fixa de salvar
  - `elevation-3`: diálogos e folhas laterais
- **Sobreposição** dos modais: grafite a 32% com desfoque de 2 px.
- **Densidade:** controles com 32 px (`sm`), 36 px (padrão) e 44 px (`lg`, usado no login e em ações de destaque).
- **Movimento:** 120 ms nas transições de estado, 100 ms na abertura de menus, 200 ms em diálogos e ≈ 300 ms nas folhas laterais. As transições usam a curva `cubic-bezier(0.2, 0, 0, 1)`, e `prefers-reduced-motion` desliga as animações.
- **Ícones:** Lucide com traço 1,75 (regra global). 18 px na navegação, 16 px nos botões.

## Temas

Há dois temas: claro (Porcelana) e escuro (Noite). **Por padrão o tema segue o sistema.**

- **Seletor:** no cabeçalho (Claro, Escuro, Automático). A escolha fica no navegador (`localStorage`, chave `clinni-theme`).
- **Sem flash:** um script curto no `<head>` aplica a classe `dark` antes da primeira pintura, seguindo o guia do Next.js sobre flash antes da hidratação.
- **Sem cookie:** o tema não usa cookie nem é lido no servidor, para que as páginas continuem pré-renderizáveis. O custo é que, em outro navegador, a escolha começa de novo.
- **Acompanham o tema:** `themeColor` (cor da barra do navegador no celular) e os toasts.

## Componentes e padrões

| Componente | Padrão |
| --- | --- |
| `PageContainer`, `PageHeader`, `Panel` | Larguras por tipo de página: listas `6xl`, painéis `7xl`, quadros (agenda, funil) até `100rem`. O título usa `title-1`, e o painel tem raio de 14 px com borda e sem sombra |
| Indicadores (dashboard, protocolos, assistente) | Cartão com borda, rótulo `text-sm` e número `text-metric` |
| `EmptyState` | Arco pontilhado com o ponto em Íris (o arco enquadra; o ponto marca o próximo passo), título e próximo passo |
| `AccessDenied`, página de erro, 404 | Mesma linguagem, com o logotipo no 404 |
| Botões, campos, selects, abas | Alturas padronizadas; foco visível com anel `ring` (35% nos campos, 50% nos demais controles) |
| Diálogos e folhas | Título 18 px semibold, sobreposição grafite, raio 18 px |
| Conversas | Mensagem da equipe em `primary-subtle`, do assistente em `info-subtle`, do contato em `muted` |
| Barra lateral | Logotipo, clínica ativa, navegação com item ativo em `nav-active`, usuário no rodapé |

## Preparação multi-clínica (somente interface)

O backend continua com **uma clínica por instalação**. Nada abaixo cria tabelas, muda autenticação ou simula dados:

- **Clínica ativa na barra lateral.** O nome vem do cadastro existente (Assistente › Configurações › Nome da clínica).
  - O menu lista “Sua clínica” e marca a ativa. Já está pronto para listar várias clínicas.
  - Quem pode configurar vê o atalho “Dados da clínica”. Enquanto a configuração nunca foi salva, vê “Configurar a clínica” e o aviso “Configuração pendente”.
- **Login.** Mostra o nome da clínica **somente depois que a configuração foi salva**, nunca um nome padrão do sistema.
- **Configuração inicial (onboarding)** no dashboard, só para administração. Cada etapa é conferida no banco, e o painel some quando todas estão concluídas:
  - dados da clínica salvos;
  - procedimentos ativos;
  - mais de uma conta ativa da equipe;
  - respostas aprovadas na base de conhecimento.
- **Contrato pronto para o backend.** `getClinicWorkspaces()` devolve `{ active, all, canConfigure }`. Com o modelo multi-clínica, basta preencher `all` com as clínicas do usuário e trocar `active` pela clínica da sessão.

Fica para a próxima etapa, porque exige backend:

- modelo de clínica (tenant) e migrações;
- clínica na sessão e troca de clínica;
- upload e armazenamento do logotipo da clínica;
- página própria de dados da clínica (hoje o nome mora nas configurações do assistente);
- domínio ou subdomínio por clínica.

## Decisões onde o manual não define

- **Logotipo compacto no escuro:** derivado pelos tokens (`tone`), sem arquivo extra.
- **Ícone do iOS:** quadrado, gerado do ícone de app com raio 0, porque o iOS aplica a própria máscara.
- **Marca da clínica:** iniciais sobre a superfície tinta até existir upload de logotipo.
- **Tema padrão:** segue o sistema. A preferência fica salva só no navegador.
- **Medidas tiradas das pranchas do dashboard:** ícones da navegação com 18 px e painéis com raio de 14 px.
- **Cores das mensagens:** equipe em Íris suave, assistente em azul-informação suave, contato em neutro, para distinguir quem escreveu sem usar o damasco.
- **Damasco fora do logotipo:** só para o assistente/IA (`insight`), por exemplo no ícone do motor de respostas na tela do assistente.
- **Painel de marca do login:** usa a superfície tinta nos dois temas, com o arco oficial a 7% de opacidade como marca-d’água.
