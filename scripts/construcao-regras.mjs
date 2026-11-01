/**
 * Regras do planejador de construção (Ofício > Fabricar, T20 Cap. 3).
 *
 * Tudo aqui é puro: categorias, sugestões de teste/CD/tempo, custo, lotes e
 * formatação do tempo. A janela (construcao-app.js) cuida de Foundry, ficha
 * e dinheiro; nada neste arquivo olha o `game`.
 *
 * Tempo: tudo é somado em horas de trabalho, para comida (1 hora) e item
 * superior (1 mês) caberem na mesma conta. A conversão depende de duas
 * preferências da ficha: horas por dia de trabalho e mês de 30 ou 28 dias.
 */

/** Frações do preço pagas como matéria-prima, na ordem do seletor. */
export const FRACOES = ['1/1', '1/2', '1/3', '1/4', '1/5', '1/6'];
export const FRACAO_PADRAO = '1/3';

export const UNIDADES_TEMPO = [
  { valor: 'hora', singular: 'hora', plural: 'horas' },
  { valor: 'dia', singular: 'dia', plural: 'dias' },
  { valor: 'semana', singular: 'semana', plural: 'semanas' },
  { valor: 'mes', singular: 'mês', plural: 'meses' },
];

export const UNIDADES_REDUCAO = [
  { valor: '%', rotulo: '%' },
  { valor: 'hora', rotulo: 'horas' },
  { valor: 'dia', rotulo: 'dias' },
  { valor: 'semana', rotulo: 'semanas' },
];

/** Penalidade de –5 no teste para fazer mais de uma unidade no mesmo tempo. */
/** Opções do multiplicador de doses. */
export const MULTIPLICADORES = [1, 2, 3, 4, 5];

export const PENALIDADE_LOTE = -5;
/** Sem instrumentos de ofício: –5 no teste. */
export const PENALIDADE_SEM_INSTRUMENTOS = -5;

/** Ofício que o sistema não traz pronto: é um ofi1..ofi9 criado na ficha. */
export const OFICIO_ESCRIBA = 'escriba';

/**
 * Categorias de fabricação, na ordem em que aparecem para o jogador.
 * `cd: null` é "a critério do mestre": o campo vem vazio.
 * `usaPm`: a CD é a base mais o custo em PM da magia.
 */
export const CATEGORIAS = [
  { id: 'armaSimples', nome: 'Armas simples', oficio: 'arme', cd: 15, tempo: 'semana' },
  { id: 'armaComplexa', nome: 'Armas marciais, exóticas e de fogo', oficio: 'arme', cd: 20, tempo: 'semana' },
  { id: 'municao', nome: 'Munições', oficio: 'arme', cd: 15, tempo: 'dia', consumivel: true, porLote: 2 },
  { id: 'armaduraLeve', nome: 'Armaduras leves e escudos', oficio: 'arme', cd: 15, tempo: 'semana' },
  { id: 'armaduraPesada', nome: 'Armaduras pesadas', oficio: 'arme', cd: 20, tempo: 'semana' },
  { id: 'aventura', nome: 'Equipamento de aventura', oficio: 'arte', cd: 15, tempo: 'semana' },
  { id: 'ferramenta', nome: 'Ferramentas', oficio: 'arte', cd: 20, tempo: 'semana' },
  { id: 'esoterico', nome: 'Esotéricos', oficio: 'arte', cd: 20, tempo: 'semana' },
  { id: 'veiculo', nome: 'Veículos', oficio: 'arte', cd: null, tempo: 'semana' },
  { id: 'vestuario', nome: 'Vestuário', oficio: 'alfa', cd: 20, tempo: 'semana' },
  { id: 'preparado', nome: 'Alquímicos: preparados', oficio: 'alqu', cd: 15, tempo: 'dia', consumivel: true, porLote: 2 },
  { id: 'catalisador', nome: 'Alquímicos: catalisadores', oficio: 'alqu', cd: 15, tempo: 'dia', consumivel: true, porLote: 2 },
  { id: 'veneno', nome: 'Alquímicos: venenos', oficio: 'alqu', cd: 20, tempo: 'dia', consumivel: true, porLote: 2 },
  { id: 'alimento', nome: 'Alimentação', oficio: 'cozi', cd: 15, tempo: 'hora', consumivel: true, porLote: 5 },
  { id: 'pocao', nome: 'Poções', oficio: 'alqu', cd: 20, tempo: 'dia', consumivel: true, porLote: 2, usaPm: true },
  { id: 'pergaminho', nome: 'Pergaminhos', oficio: OFICIO_ESCRIBA, cd: 20, tempo: 'dia', consumivel: true, porLote: 2, usaPm: true },
  { id: 'consumivelOutro', nome: 'Outros consumíveis', oficio: 'arte', cd: 15, tempo: 'dia', consumivel: true, porLote: 2 },
  { id: 'magico', nome: 'Superiores e mágicos', oficio: 'arte', cd: null, tempo: 'mes' },
  { id: 'outro', nome: 'Outros', oficio: 'arte', cd: 15, tempo: 'semana' },
];

const POR_ID = new Map(CATEGORIAS.map(c => [c.id, c]));

export function categoria(id) {
  return POR_ID.get(id) ?? POR_ID.get('outro');
}

/* ── Preferências da ficha ──────────────────────────────────── */

export function prefsPadrao() {
  return {
    categorias: Object.fromEntries(CATEGORIAS.map(c => [c.id, {
      oficio: c.oficio, cd: c.cd, fracao: FRACAO_PADRAO, tempoValor: 1, tempoUnidade: c.tempo,
    }])),
    diasNoMes: 30,
    horasPorDia: 8,
    rolarTestes: true,
    falhaGastaMaterial: true,
    semInstrumentos: [],
    loteConsumivel: false,
    multDoses: 1,
    reducaoValor: 0,
    reducaoUnidade: '%',
  };
}

/** Preferências salvas por cima das padrão (categoria nova entra sozinha). */
export function prefsCompletas(salvas = {}) {
  const base = prefsPadrao();
  const { categorias = {}, ...gerais } = salvas ?? {};
  for (const [id, valores] of Object.entries(categorias)) {
    if (base.categorias[id]) Object.assign(base.categorias[id], valores);
  }
  return { ...base, ...gerais, categorias: base.categorias };
}

/* ── Classificação do item ──────────────────────────────────── */

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Descrição em texto corrido, para as buscas abaixo. */
function textoDaDescricao(item) {
  const bruto = item.system?.description?.value ?? '';
  return normalizar(String(bruto).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, m => ENTIDADES[m.toLowerCase()] ?? ' ')).replace(/\s+/g, ' ');
}

/* As descrições do compêndio vêm com acentos em entidades HTML. */
const ENTIDADES = {
  '&aacute;': 'a', '&acirc;': 'a', '&atilde;': 'a', '&ccedil;': 'c', '&eacute;': 'e', '&ecirc;': 'e',
  '&iacute;': 'i', '&oacute;': 'o', '&ocirc;': 'o', '&otilde;': 'o', '&uacute;': 'u', '&nbsp;': ' ',
};

const RE_VEICULO = /\b(balao|carroca|carruagem|canoa|veleiro|barco|navio|jangada)\b/;
const RE_POCAO_NOME = /^(pocao|oleo|granada)\b/;
/* T20 1.5 escreve "Tipo: Ingestão."; o 1.6, "... da vítima. Ingestão, vítima fica ...". */
const RE_VENENO_TEXTO = /(\btipo:? |[.!] |^)(ingestao|contato|inalacao)\b/;

/* Catalisadores do Básico: o sistema não os separa dos preparados. */
const CATALISADORES = [
  'baga-de-fogo', 'dente-de-dragao', 'essencia abissal', 'essencia de mana', 'liquen lilas',
  'musgo purpura', 'ossos de monstro', 'po de cristal', 'po de giz', 'ramo verdejante',
  'saco de sal', 'seixo de ambar', 'terra de cemiterio',
];

function categoriaAlquimica(item) {
  const nome = normalizar(item.name);
  if (nome.includes('veneno') || nome.includes('peconha') || RE_VENENO_TEXTO.test(textoDaDescricao(item))) return 'veneno';
  if (CATALISADORES.includes(nome)) return 'catalisador';
  return 'preparado';
}

function categoriaConsumivel(item, tipo) {
  switch (tipo) {
    // Há poção cadastrada como munição no compêndio (Poção de Enfeitiçar).
    case 'ammo': return RE_POCAO_NOME.test(normalizar(item.name)) ? 'pocao' : 'municao';
    case 'food': return 'alimento';
    case 'potion': return 'pocao';
    case 'scroll': return 'pergaminho';
    case 'alchemy': return categoriaAlquimica(item);
    default: return 'consumivelOutro';
  }
}

function categoriaEquipamento(item, tipo) {
  switch (tipo) {
    case 'escudo':
    case 'leve': return 'armaduraLeve';
    case 'pesada': return 'armaduraPesada';
    case 'ferramenta': return 'ferramenta';
    case 'esoterico': return 'esoterico';
    case 'traje': return /simbolo sagrado/.test(normalizar(item.name)) ? 'aventura' : 'vestuario';
    case 'acessorio': return 'magico';
    default: return 'aventura';
  }
}

/** Categoria sugerida para um item; `magico` vem de quem conhece as flags. */
export function categoriaDoItem(item, { magico = false } = {}) {
  const sistema = item.system ?? {};
  const tipo = sistema.tipo?.value ?? sistema.tipo ?? '';
  if (item.type === 'arma') return sistema.proficiencia === 'simples' ? 'armaSimples' : 'armaComplexa';
  if (item.type === 'equipamento') return categoriaEquipamento(item, tipo);
  if (item.type === 'consumivel') return categoriaConsumivel(item, tipo);
  if (item.type === 'tesouro') {
    if (magico) return 'magico';
    return RE_VEICULO.test(normalizar(item.name)) ? 'veiculo' : 'aventura';
  }
  return 'outro';
}

/** "A CD para fabricar ... aumenta em +5" na descrição (Beladona, Pó de Lich). */
export function ajusteCdDaDescricao(item) {
  const achado = textoDaDescricao(item).match(/cd para fabricar[^.]*?aumenta em \+?(\d+)/);
  return achado ? Number(achado[1]) : 0;
}

/** Custo em PM de poção/pergaminho pronto: inverso de T$ 30 × PM². */
export function pmDoPreco(preco) {
  return Math.max(1, Math.round(Math.sqrt((Number(preco) || 0) / 30)));
}

/* ── Sugestões ──────────────────────────────────────────────── */

/** +5 por melhoria (1 a 4) e +10/+15/+20 para 1/2/3 encantos. */
export function aumentoDeCd(nMelhorias = 0, nEncantos = 0) {
  const melhorias = nMelhorias > 0 ? nMelhorias * 5 : 0;
  const encantos = nEncantos > 0 ? 5 + nEncantos * 5 : 0;
  return melhorias + encantos;
}

/** Item superior ou mágico que não é consumível leva o tempo e a fração de "Superiores e mágicos". */
function usaLinhaSuperior(linha) {
  return !!linha.superior && !categoria(linha.categoria).consumivel;
}

/** CD sugerida; `null` quando a categoria fica a critério do mestre. */
export function cdSugerida(linha, prefs) {
  const base = prefs.categorias[linha.categoria]?.cd ?? null;
  if (base === null || base === '') return null;
  if (categoria(linha.categoria).usaPm) return Number(base) + (Number(linha.pm) || 0);
  return Number(base) + (Number(linha.ajusteCd) || 0) + aumentoDeCd(linha.nMelhorias, linha.nEncantos);
}

/** Campos que vêm das preferências quando a linha nasce ou troca de categoria. */
export function sugestoes(linha, prefs) {
  const daCategoria = prefs.categorias[linha.categoria];
  const superior = usaLinhaSuperior(linha) ? prefs.categorias.magico : daCategoria;
  const cat = categoria(linha.categoria);
  const lote = !!cat.consumivel && !!prefs.loteConsumivel;
  const multDoses = cat.consumivel ? (Number(prefs.multDoses) || 1) : 1;
  return {
    oficio: daCategoria.oficio,
    cd: cdSugerida(linha, prefs),
    fracao: superior.fracao,
    tempoValor: superior.tempoValor,
    tempoUnidade: superior.tempoUnidade,
    lote,
    multDoses,
  };
}

/* ── Conta da linha ─────────────────────────────────────────── */

export function valorDaFracao(fracao) {
  const [cima, baixo] = String(fracao).split('/').map(Number);
  return cima > 0 && baixo > 0 ? cima / baixo : 1 / 3;
}

export function horasDoTempo(valor, unidade, prefs) {
  const n = Math.max(0, Number(valor) || 0);
  const dia = Number(prefs.horasPorDia) || 8;
  switch (unidade) {
    case 'hora': return n;
    case 'dia': return n * dia;
    case 'semana': return n * 7 * dia;
    case 'mes': return n * (Number(prefs.diasNoMes) || 30) * dia;
    default: return n;
  }
}

/** Unidades que o multiplicador de doses entrega por teste sem penalidade. */
function unidadesSemPenalidade(linha) {
  return categoria(linha.categoria).consumivel ? (Number(linha.multDoses) || 1) : 1;
}

/** Unidades feitas em um teste: –5 e o multiplicador de doses se multiplicam (–5 com ×2 são 4). */
export function tamanhoDoLote(linha) {
  const cat = categoria(linha.categoria);
  return (linha.lote && cat.consumivel ? cat.porLote : 1) * unidadesSemPenalidade(linha);
}

/** A ficha marcou que não tem os instrumentos do Ofício deste teste? */
function faltamInstrumentos(prefs, linha) {
  return Array.isArray(prefs.semInstrumentos) && prefs.semInstrumentos.includes(linha.oficio);
}

/** Penalidades de cada teste da linha, por motivo. */
export function penalidadesDoTeste(prefs, linha) {
  const lista = [];
  if (linha.lote && categoria(linha.categoria).consumivel) lista.push({ nome: 'Fabricar mais unidades', valor: PENALIDADE_LOTE });
  if (faltamInstrumentos(prefs, linha)) lista.push({ nome: 'Sem instrumentos de ofício', valor: PENALIDADE_SEM_INSTRUMENTOS });
  return lista;
}

/** Modificador de cada teste da linha. */
export function modificadorDoTeste(prefs, linha) {
  const penalidade = linha.lote && categoria(linha.categoria).consumivel ? PENALIDADE_LOTE : 0;
  return penalidade + (faltamInstrumentos(prefs, linha) ? PENALIDADE_SEM_INSTRUMENTOS : 0);
}

export function calcularLinha(linha, prefs) {
  // Qtd é quantas vezes o craft é feito: cada vez é um teste e uma vez o tempo.
  const lotes = Array(Math.max(1, linha.qtd)).fill(tamanhoDoLote(linha));
  const unidades = lotes.length * lotes[0];

  const tempoBase = horasDoTempo(linha.tempoValor, linha.tempoUnidade, prefs);
  const reducao = linha.reducaoUnidade === '%'
    ? tempoBase * Math.min(100, Math.max(0, Number(linha.reducaoValor) || 0)) / 100
    : horasDoTempo(linha.reducaoValor, linha.reducaoUnidade, prefs);
  const tempoPorLote = Math.max(0, tempoBase - reducao);
  const tempoHoras = linha.gastaTempo === false ? 0 : tempoPorLote * lotes.length;

  const unitarioCobre = Math.max(1, Math.floor(linha.preco * valorDaFracao(linha.fracao) * 10));
  const descontoCobre = Math.round((Number(linha.desconto) || 0) * 10);
  const custoCobre = Math.max(0, unitarioCobre * unidades - descontoCobre);

  return { lotes, unidades, tempoPorLote, tempoHoras, unitarioCobre, descontoCobre, custoCobre };
}

/** Total do plano: dinheiro, tempo e quantos testes serão rolados. */
export function resumirPlano(linhas, prefs) {
  let custoCobre = 0;
  let tempoHoras = 0;
  let testes = 0;
  for (const linha of linhas) {
    const conta = calcularLinha(linha, prefs);
    custoCobre += conta.custoCobre;
    tempoHoras += conta.tempoHoras;
    testes += conta.lotes.length;
  }
  return { custoCobre, tempoHoras, testes };
}

/** "1 mês, 2 semanas e 3 dias". O que não fecha um dia sai em horas. */
export function formatarTempo(horas, prefs) {
  const total = Math.round((Number(horas) || 0) * 100) / 100;
  if (total <= 0) return 'Nenhum';

  const dia = Number(prefs.horasPorDia) || 8;
  const horasNoMes = (Number(prefs.diasNoMes) || 30) * dia;
  const horasNaSemana = 7 * dia;

  const meses = Math.floor(total / horasNoMes);
  let resto = total - meses * horasNoMes;
  const semanas = Math.floor(resto / horasNaSemana);
  resto -= semanas * horasNaSemana;
  const dias = Math.floor(resto / dia);
  resto = Math.round((resto - dias * dia) * 100) / 100;

  const partes = [];
  const por = (n, um, varios) => { if (n > 0) partes.push(`${n} ${n === 1 ? um : varios}`); };
  por(meses, 'mês', 'meses');
  por(semanas, 'semana', 'semanas');
  por(dias, 'dia', 'dias');
  por(resto, 'hora', 'horas');
  if (partes.length < 2) return partes[0];
  return `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`;
}
