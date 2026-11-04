import { isConfidentMatch, rankPassages } from "./knowledge-search";
import { extractName, normalizeText, parseOptionNumber, parseSchedulePreference, parseYesNo } from "./text";
import { emptyInterpretation, INFORMATIONAL_INTENTS, type AssistantModel, type Intent, type InterpretInput, type Interpretation } from "./types";

/**
 * Motor por regras — SEM IA generativa. Classifica a intenção por palavras-chave
 * e, para perguntas informativas, devolve o texto aprovado da entrada mais
 * relevante da base de conhecimento, sem reescrever nada. Nenhum dado sai do
 * servidor. Usado em desenvolvimento, nos testes e por clínicas que preferem
 * não usar um provedor de IA.
 */

const URGENT = /\b(urgente|urgencia|emergencia|falta de ar|nao consigo respirar|desmai\w*|sangrando muito|sangramento|muita dor|dor forte|dor muito forte|inchaco forte|muito inchad\w*|febre alta|febre|perdi a visao|visao turva|necrose|pus|infeccionou|infeccao)\b/;

/** Pergunta de saúde/conduta (usado também como sinal para a IA generativa). */
export const CLINICAL = /\b(dor|doi|doendo|alergi\w*|inchad\w*|inchaco|roxo|roxa|hematoma|vermelh\w*|coceira|remedio|medicamento|antibiotico|anticoncepcional|gravida|gestante|gravidez|amamentando|amamentacao|lactante|efeito colateral|efeitos colaterais|reacao|reacoes|cicatriz\w*|herpes|diabet\w*|pressao alta|hipertens\w*|anticoagulante|posso tomar|posso beber|posso fazer (mesmo|estando|tomando|gravida|com)|contraindica\w*|diagnostico|receita|indicad[oa] para mim|qual (tratamento|procedimento) (e|seria) (melhor|ideal|indicado) para (mim|o meu|a minha))\b/;

const HUMAN = /\b(atendente|humano|humana|falar com (uma |um |a |o )?(pessoa|alguem|atendente|recepcao|recepcionista|secretaria|equipe|doutora|dra|daniela)|pessoa de verdade|recepcao|recepcionista|secretaria)\b/;

const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  ["reschedule", /\b(remarcar|reagendar|mudar (o |meu |a minha )?(horario|agendamento|consulta|data)|trocar (o |meu |a )?(horario|data|dia)|adiar|antecipar)\b/],
  ["cancel_appointment", /\b(desmarcar|cancelar (o |a |meu |minha )?(consulta|agendamento|horario|avaliacao|sessao|atendimento|procedimento))\b/],
  ["pricing", /\b(preco|precos|valor|valores|quanto custa|quanto e|quanto fica|quanto sai|custa|custo|investimento|parcel\w*|desconto|promocao|formas? de pagamento|pix|cartao)\b/],
  ["admin_info", /\b(endereco|onde fica|onde voces ficam|localizacao|como chego|como chegar|estacionamento|horario de (atendimento|funcionamento)|que horas (abre|fecha|voces abrem|voces fecham)|funcionam|telefone|contato|politica|atraso|tolerancia)\b/],
  ["schedule", /\b(agendar|agendamento|marcar|horario disponivel|horarios disponiveis|tem horario|disponibilidade|tem vaga|vaga|quero uma consulta|avaliacao|consulta)\b/],
  ["services", /\b(procedimento|procedimentos|servico|servicos|tratamento|tratamentos|voces fazem|fazem|trabalham com|oferecem|como funciona|botox|toxina|preenchimento|bioestimulador|limpeza de pele|peeling|harmonizacao|skinbooster|fios|laser|microagulhamento)\b/],
  ["thanks", /\b(obrigad[oa]|valeu|agradeco|grata|grato|tchau|ate mais|ate logo)\b/],
];

const GREETING = /^(oi+|ola|ole|bom dia|boa tarde|boa noite|e ai|hey|alo|tudo bem|tudo bom|oi tudo bem|ola tudo bem)\b/;

export function classifyIntent(message: string): Intent {
  if (HUMAN.test(message)) return "human";
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(message)) return intent;
  }
  const yesNo = parseYesNo(message);
  if (yesNo !== null) return yesNo ? "affirm" : "deny";
  if (GREETING.test(message) && message.split(" ").length <= 5) return "greeting";
  return "other";
}

export class RulesAssistantModel implements AssistantModel {
  readonly name = "rules";

  async interpret(input: InterpretInput): Promise<Interpretation> {
    const message = normalizeText(input.text);
    const result = emptyInterpretation(classifyIntent(message));
    result.confidence = result.intent === "other" ? 0.3 : 0.7;

    result.flags.urgent = URGENT.test(message);
    result.flags.clinical = result.flags.urgent || CLINICAL.test(message);
    result.flags.wantsHuman = result.intent === "human";

    result.entities.name = extractName(input.text, input.expecting === "name");
    const preference = parseSchedulePreference(input.text, input.today);
    result.entities.period = preference.period ?? null;
    result.entities.date = preference.date ?? null;
    result.entities.weekday = preference.weekday ?? null;
    result.entities.optionNumber = input.options.length > 0 ? parseOptionNumber(input.text, input.options.length) : null;

    if (INFORMATIONAL_INTENTS.has(result.intent) && !result.flags.clinical) {
      const [best] = rankPassages(input.text, input.passages, result.intent);
      if (best && isConfidentMatch(best)) {
        // Texto aprovado, sem reescrita: o que a equipe aprovou é exatamente o que o contato lê.
        result.answer = { found: true, text: best.passage.content, sourceIds: [best.passage.id] };
        if (result.intent === "other") result.intent = best.passage.category === "PRICING" ? "pricing" : "services";
      }
    }
    return result;
  }
}
