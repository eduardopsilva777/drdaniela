# Segurança e LGPD

## Princípios

- **Servidor decide.** Toda leitura e escrita de dados protegidos passa pela DAL (`src/server/auth/dal.ts`), que valida a sessão no banco a cada requisição. Permissões são conferidas na página, na Server Action e de novo no serviço — esconder um botão nunca é a proteção.
- **Mínimo necessário.** Dados de saúde são sensíveis (LGPD art. 11): o CRM comercial não pede CPF, endereço ou documentos; observações clínicas ficam separadas, cifradas e com acesso restrito.
- **Rastreabilidade sem exposição.** A auditoria registra quem fez o quê e quando, sem copiar o conteúdo dos dados.

## Autenticação e sessões

- Senhas com **Argon2id** (parâmetros mínimos da OWASP, com *rehash* automático); política do NIST SP 800-63B (mín. 12 caracteres, sem senhas óbvias, sem regras arbitrárias de composição).
- Sessão no banco: o cookie guarda um token aleatório de 256 bits; o banco guarda só o SHA-256. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção.
- Expiração absoluta (padrão 12 h) e por inatividade (padrão 2 h). Desativar uma conta encerra as sessões na hora.
- Limite de tentativas: 5 falhas por e-mail em 15 min (e 20 por IP com `TRUST_PROXY=true`). Mesma resposta para e-mail inexistente, senha errada e conta desativada.
- **Senhas provisórias** (criadas/redefinidas pela administração) são aleatórias, exibidas uma única vez e exigem troca no primeiro acesso: até a troca, toda página e ação leva à tela de nova senha. Trocar a senha encerra as demais sessões.
- A troca da própria senha confere a senha atual **com o mesmo limite de tentativas do login** (as falhas contam também para o login e ficam na auditoria) — uma sessão sequestrada não serve para adivinhar a senha.
- A tela de conversas não se atualiza sozinha, para não manter sessões ociosas ativas.

## Autorização (perfis)

| Permissão | Recepção | Profissional | Administração |
| --- | :---: | :---: | :---: |
| Leads, pacientes, agenda, retornos, lembretes, WhatsApp | ✓ | ✓ | ✓ |
| Excluir leads, inativar pacientes | | ✓ | ✓ |
| Procedimentos e protocolos (catálogo), aplicar/cancelar protocolos | | ✓ | ✓ |
| Processar a fila de lembretes manualmente | | ✓ | ✓ |
| Observações clínicas (ler e escrever; leitura auditada) | | ✓ | ✓ |
| Equipe, auditoria, exportação de dados de pacientes | | | ✓ |

Mapa completo em [`src/lib/auth/permissions.ts`](../src/lib/auth/permissions.ts). Negativas no servidor são auditadas (`auth.access_denied`).

## Auditoria

- Tabela **somente inserção** (trigger bloqueia `UPDATE`/`DELETE`); contas com histórico não podem ser apagadas.
- Registra: entradas, saídas, falhas e bloqueios de login; criação/alteração/desativação de contas e senhas; leads (criação, edição, etapas, conversão, exclusão); pacientes (cadastro, edição, **cada alteração de consentimento**, inativação, **leitura de observações clínicas**, **exportação**); agenda; protocolos e retornos; lembretes; envios de WhatsApp; rotina de retenção.
- `metadata` aceita só valores simples e passa por redação defensiva — nunca conteúdo de dados pessoais ou clínicos.
- Tela de consulta em **Gestão → Auditoria** (Administração).

## Proteção dos dados de saúde

- **Observações cifradas** com AES-256-GCM (`DATA_ENCRYPTION_KEY`), com o id do paciente como dado autenticado. Sem a chave, nada é gravado (a tela avisa); com chave errada, a observação aparece como ilegível em vez de falhar a página.
- **Guarde a chave** com o mesmo cuidado do backup do banco: sem ela, observações antigas não podem ser lidas.
- **Rotação:** durante a troca, a chave anterior (`DATA_ENCRYPTION_KEY_PREVIOUS`) é aceita só para leitura e `npm run data:rotate-key` recifra tudo com a chave nova (simulação por padrão, auditado). Procedimento em [operacao.md](operacao.md#rotação-da-data_encryption_key).
- Observações **clínicas** só para Profissional/Administração; cada leitura é auditada. Observações **administrativas** (ex.: preferência de horário) são visíveis à equipe.
- O CRM não faz diagnóstico, prescrição nem decisão clínica automatizada; protocolos são intervalos de datas definidos pela profissional.

## Consentimento e finalidade

| Consentimento | Finalidade | Efeito |
| --- | --- | --- |
| WhatsApp | Lembretes de agendamento e de retorno; conversas com a equipe | Sem ele, nenhum lembrete é criado; revogar cancela os pendentes |
| Comunicações promocionais | Campanhas e novidades da clínica | Registrado para uso futuro; o CRM não envia campanhas |
| Uso de imagem | Uso de fotos em materiais, conforme termo assinado | Apenas registro (o CRM não armazena imagens) |

Cada consentimento guarda a data da última alteração; o histórico completo (concedido/revogado, por quem, quando) fica na auditoria.

## Direitos do titular (LGPD art. 18)

- **Acesso e portabilidade:** “Exportar dados” na ficha do paciente (Administração) gera um JSON com cadastro, origem comercial, interações, agendamentos, procedimentos, protocolos, retornos, mensagens e observações decifradas. A exportação é auditada e recusada quando a navegação vem de outro site (um link externo não consegue dispará-la).
- **Correção:** edição do cadastro (auditada).
- **Eliminação:** leads sem vínculo clínico podem ser excluídos definitivamente. Para pacientes, a eliminação esbarra em obrigações legais de guarda do histórico de atendimento — o caminho atual é a **inativação**; anonimização definitiva exige decisão jurídica da clínica (ver pendências).
- **Revogação de consentimento:** desmarcar no cadastro; efeitos imediatos.

## Retenção de dados

Rotina explícita: `npm run data:retention` (simulação) / `npm run data:retention -- --apply` (executa e audita). Política atual (dados **técnicos**):

| Dado | Prazo |
| --- | --- |
| Sessões expiradas | Removidas na próxima execução |
| Tentativas de login | 90 dias |
| Registro de eventos de webhook (sem conteúdo) | 90 dias |

Não são apagados automaticamente: auditoria (somente inserção — a retenção dela deve ser feita por um papel administrativo do banco, de forma explícita), dados de pacientes, leads, agenda e conversas. Os prazos desses dados dependem de definição jurídica da clínica (por exemplo, guarda de registros de atendimento) e de pedidos dos titulares.

## Webhooks e integrações

- Webhook do WhatsApp autenticado por HMAC do corpo bruto, idempotente e **sem armazenar o payload**.
- Processamento da fila exige `CRON_SECRET` (comparação em tempo constante).
- Tokens e segredos só em variáveis de ambiente; mensagens de erro de configuração listam apenas nomes de variáveis.

## Infraestrutura

- Cabeçalhos: CSP restritiva (sem origens externas), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, `X-Robots-Tag: noindex` e HSTS em HTTPS.
- Logs estruturados com redação de senhas, tokens, telefones, e-mails e CPFs, e dos valores que o PostgreSQL repete em erros de restrição (`Failing row contains…`, `Key (…)=(…)`); consultas de busca não são registradas.
- Em produção o Prisma não imprime erros por conta própria (eles passam pelo logger com redação) e usa mensagens mínimas, sem a consulta formatada.
- No desenvolvimento, o registro de argumentos das Server Actions no terminal está desligado.
- Backups do banco e da `DATA_ENCRYPTION_KEY` (guardados separadamente) são responsabilidade da hospedagem.

## Assistente virtual e IA

- **Provedor de IA desligado por padrão** (`AI_PROVIDER=disabled` em produção). Com `anthropic`, só vai ao provedor o contexto mínimo do contato (primeiro nome, etapa, interesse, consentimentos, datas de agendamentos e retornos), as entradas aprovadas da base, as notas da conversa e o histórico recente — com telefone, e-mail e CPF mascarados. **Nunca**: observações, prontuário, procedimentos realizados, dados de outros contatos. Transferência internacional exige contrato e base legal (art. 33).
- **O modelo não acessa o banco**: pede ferramentas de uma lista fechada, com argumentos validados e regras do CRM aplicadas pelo servidor; referências curtas (A1, S1, R1) impedem alcançar dados de outra pessoa.
- **Ações importantes com confirmação explícita** conferida pelo servidor; a resposta não pode afirmar o que não foi gravado.
- **Checagem das respostas**: valores, percentuais, telefones e links só com fonte; sem promessa de resultado; sem se passar pela profissional; dúvidas de saúde e urgências vão para a equipe.
- **Manipulação (prompt injection)**: o texto do contato vai marcado como dado; pedidos para ignorar regras não liberam ações (as regras estão no servidor).
- **Notas da conversa cifradas**, incluídas na exportação do titular, no apagamento da conversa e na rotação de chave. Registros de execução sem conteúdo.
- **Sem treinamento** de modelos com conversas; melhoria só por curadoria humana da base aprovada.

## Pendências de segurança/LGPD

- **Anonimização** de pacientes e prazos de retenção de dados pessoais — dependem de definição jurídica.
- Autenticação em dois fatores para a Administração.
- Relatório de auditoria exportável (hoje: consulta na tela).
