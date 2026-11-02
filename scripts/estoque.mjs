/**
 * Estoque por mercador.
 *
 * Por padrão a loja é um catálogo infinito: tudo o que está nas fontes
 * configuradas pode ser comprado em qualquer quantidade. Em campanhas de
 * escassez isso não serve — a vila do interior não vende o que a capital
 * vende. Aqui o mestre marca um ator como MERCADOR e o escolhe como o
 * estoque ativo da loja; enquanto ele estiver ativo:
 *
 *   • a vitrine mostra só os itens do inventário dele, com a quantidade
 *     disponível;
 *   • comprar tira as unidades do inventário do mercador;
 *   • vender põe o item no inventário do mercador (outro jogador pode
 *     comprá-lo depois).
 *
 * Os jogadores normalmente não são donos do ator do mercador, então não
 * podem alterá-lo. As alterações no inventário dele passam pelo mestre
 * conectado, por socket (module.json → "socket": true). Quem é dono do
 * mercador (o mestre, tipicamente) executa direto, sem socket.
 */

const MODULE_ID = 't20-hayd-loja';
const SOCKET = `module.${MODULE_ID}`;

/** Flag de ator: este ator pode ser escolhido como estoque da loja. */
export const FLAG_MERCADOR = 'mercador';

/** Mesmos tipos que a aba de venda aceita: só itens físicos de inventário. */
export const TIPOS_DE_ESTOQUE = new Set(['arma', 'equipamento', 'consumivel', 'tesouro']);

/** Tempo máximo de espera pela resposta do mestre. */
const TEMPO_LIMITE_MS = 10000;

/* ── Consulta ───────────────────────────────── */

export function ehMercador(actor) {
  return !!actor?.getFlag?.(MODULE_ID, FLAG_MERCADOR);
}

/** Atores marcados como mercador, em ordem alfabética. */
export function listarMercadores() {
  return (game.actors?.filter(a => ehMercador(a)) ?? [])
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));
}

/** Id gravado na configuração (pode apontar para um ator que já não existe). */
export function idMercadorAtivo() {
  try { return game.settings.get(MODULE_ID, 'mercadorAtivo') || ''; }
  catch (_e) { return ''; }
}

/**
 * Mercador cujo estoque a loja usa agora, ou null para a loja geral
 * (catálogo sem limite). Um ator apagado ou desmarcado cai na loja geral.
 */
export function mercadorAtivo() {
  const id = idMercadorAtivo();
  if (!id) return null;
  const ator = game.actors?.get(id);
  return ehMercador(ator) ? ator : null;
}

/** Quantidade de um item em estoque (sem qtd definida conta como 1). */
export function quantidadeEmEstoque(item) {
  const bruto = item?.system?.qtd;
  if (bruto === undefined || bruto === null || bruto === '') return 1;
  const n = Number(bruto);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1;
}

/** O item do inventário do mercador pode ser vendido pela loja? */
export function itemVendavelDoEstoque(item) {
  if (!item || !TIPOS_DE_ESTOQUE.has(item.type)) return false;
  if (!(Number(item.system?.preco) > 0)) return false;
  return quantidadeEmEstoque(item) > 0;
}

/* ── Execução (no cliente que pode alterar o mercador) ── */

/* Fila: duas compras simultâneas da última unidade não podem passar as
 * duas pela verificação de estoque antes de uma delas descontar. */
let fila = Promise.resolve();
function enfileirar(fn) {
  const r = fila.then(fn, fn);
  fila = r.catch(() => {});
  return r;
}

function mercadorParaOperacao(mercadorId) {
  const ator = game.actors?.get(mercadorId);
  if (!ehMercador(ator)) throw new Error('Este ator não é mais um mercador da loja.');
  if (ator.id !== idMercadorAtivo()) throw new Error('Este mercador não é mais o estoque ativo da loja.');
  return ator;
}

/**
 * Retira itens do estoque, tudo ou nada: se algum não tiver a quantidade
 * pedida, nada é retirado. Devolve os dados de cada item retirado (já
 * com system.qtd = quantidade levada), na ordem pedida.
 * @param {{mercadorId:string, itens:{itemId:string, qtd:number}[]}} dados
 */
async function executarRetirada({ mercadorId, itens }) {
  const mercador = mercadorParaOperacao(mercadorId);

  // Soma pedidos repetidos do mesmo item antes de conferir
  const pedidos = new Map();
  for (const { itemId, qtd } of itens ?? []) {
    const n = Math.floor(Number(qtd));
    if (!(n > 0)) throw new Error('Quantidade inválida.');
    pedidos.set(itemId, (pedidos.get(itemId) ?? 0) + n);
  }

  for (const [itemId, qtd] of pedidos) {
    const item = mercador.items.get(itemId);
    if (!item || !itemVendavelDoEstoque(item)) {
      throw new Error(`${mercador.name} não tem mais esse item.`);
    }
    const disponivel = quantidadeEmEstoque(item);
    if (disponivel < qtd) {
      throw new Error(`${mercador.name} só tem ${disponivel} × ${item.name}.`);
    }
  }

  const retirados = (itens ?? []).map(({ itemId, qtd }) => {
    const dados = mercador.items.get(itemId).toObject();
    delete dados._id;
    dados.system ??= {};
    dados.system.qtd = Math.floor(Number(qtd));
    return dados;
  });

  const apagar = [];
  const atualizar = [];
  for (const [itemId, qtd] of pedidos) {
    const resto = quantidadeEmEstoque(mercador.items.get(itemId)) - qtd;
    if (resto <= 0) apagar.push(itemId);
    else atualizar.push({ _id: itemId, 'system.qtd': resto });
  }
  if (atualizar.length) await mercador.updateEmbeddedDocuments('Item', atualizar);
  if (apagar.length) await mercador.deleteEmbeddedDocuments('Item', apagar);

  return retirados;
}

/**
 * Põe um item no estoque, empilhando com um igual (mesmo nome e tipo,
 * sem aprimoramentos da loja) quando houver.
 * @param {{mercadorId:string, itemData:object, qtd:number}} dados
 */
async function executarDeposito({ mercadorId, itemData, qtd }) {
  const mercador = mercadorParaOperacao(mercadorId);
  const n = Math.floor(Number(qtd));
  if (!(n > 0)) throw new Error('Quantidade inválida.');
  if (!itemData || !TIPOS_DE_ESTOQUE.has(itemData.type)) {
    throw new Error('O mercador não compra esse tipo de item.');
  }

  const aprimorado = !!itemData.flags?.[MODULE_ID]?.aprimoramentos;
  const igual = aprimorado ? null : mercador.items.find(i =>
    i.type === itemData.type
    && i.name === itemData.name
    && !i.getFlag(MODULE_ID, 'aprimoramentos')
    && i.system?.qtd !== undefined);

  if (igual) {
    await igual.update({ 'system.qtd': quantidadeEmEstoque(igual) + n });
    return true;
  }
  const dados = foundry.utils.deepClone(itemData);
  delete dados._id;
  dados.system ??= {};
  dados.system.qtd = n;
  await mercador.createEmbeddedDocuments('Item', [dados]);
  return true;
}

const ACOES = {
  retirar  : executarRetirada,
  depositar: executarDeposito,
};

/* ── Socket ─────────────────────────────────── */

const pendentes = new Map(); // id → { resolve, reject, timer }

/** O mestre que atende os pedidos: um só, para não executar em dobro. */
function souMestreQueAtende() {
  const gm = game.users?.activeGM;
  return !!gm && gm.id === game.user?.id;
}

async function aoReceber(msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.tipo === 'resposta') {
    if (msg.para !== game.user?.id) return;
    const p = pendentes.get(msg.id);
    if (!p) return;
    pendentes.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.resultado);
    else p.reject(new Error(msg.erro || 'O mestre recusou a operação.'));
    return;
  }

  if (msg.tipo !== 'pedido' || !souMestreQueAtende()) return;
  const acao = ACOES[msg.acao];
  let resposta;
  try {
    if (!acao) throw new Error(`Operação desconhecida: ${msg.acao}`);
    const resultado = await enfileirar(() => acao(msg.dados ?? {}));
    resposta = { ok: true, resultado };
  } catch (err) {
    resposta = { ok: false, erro: err?.message ?? String(err) };
  }
  game.socket.emit(SOCKET, { tipo: 'resposta', id: msg.id, para: msg.de, ...resposta });
}

/** Liga o socket. Chamar no hook ready. */
export function registrarSocketEstoque() {
  game.socket?.on(SOCKET, aoReceber);
}

/**
 * Executa a ação aqui mesmo, se este usuário pode alterar o mercador, ou
 * pede ao mestre conectado.
 */
async function executar(acao, dados) {
  const mercador = game.actors?.get(dados.mercadorId);
  if (mercador?.isOwner) return enfileirar(() => ACOES[acao](dados));

  if (!game.users?.activeGM) {
    throw new Error('É preciso um mestre conectado para negociar com o mercador.');
  }
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendentes.delete(id);
      reject(new Error('O mestre não respondeu a tempo. Tente de novo.'));
    }, TEMPO_LIMITE_MS);
    pendentes.set(id, { resolve, reject, timer });
    game.socket.emit(SOCKET, { tipo: 'pedido', id, de: game.user.id, acao, dados });
  });
}

/** Retira itens do estoque do mercador (tudo ou nada). */
export function retirarDoEstoque(mercadorId, itens) {
  return executar('retirar', { mercadorId, itens });
}

/** Põe um item no estoque do mercador. */
export function depositarNoEstoque(mercadorId, itemData, qtd) {
  return executar('depositar', { mercadorId, itemData, qtd });
}

/* ── Entrega ao comprador ───────────────────── */

/**
 * Entrega ao comprador um item vindo do estoque, empilhando como as
 * compras do catálogo (mesma origem ou mesmo nome, nunca item aprimorado).
 */
export async function entregarItem(actor, itemData, qtd) {
  const origem = itemData.flags?.[MODULE_ID]?.sourceUuid ?? null;
  const aprimorado = !!itemData.flags?.[MODULE_ID]?.aprimoramentos;
  const existente = aprimorado ? null : actor.items.find(i => {
    if (i.getFlag(MODULE_ID, 'aprimoramentos')) return false;
    const flag = i.getFlag(MODULE_ID, 'sourceUuid');
    return (origem && flag === origem) || i.name === itemData.name;
  });
  if (existente && existente.system?.qtd !== undefined) {
    await existente.update({ 'system.qtd': (Number(existente.system.qtd) || 0) + qtd });
    return existente;
  }
  const dados = foundry.utils.deepClone(itemData);
  dados.system ??= {};
  dados.system.qtd = qtd;
  const [criado] = await actor.createEmbeddedDocuments('Item', [dados]);
  return criado;
}

/* ── Configuração, menu de contexto e atualização das janelas ── */

/** Re-renderiza as vitrines abertas (o estoque mudou ou trocou). */
function rerenderVitrines() {
  for (const app of Object.values(ui.windows)) {
    const el = app.element?.[0];
    if (el?.classList.contains('t20-loja-window')) app.render(false);
  }
}
const rerenderVitrinesDebounced = foundry.utils.debounce(rerenderVitrines, 150);

/** Registra a configuração e os hooks. Chamar no hook init. */
export function registrarEstoque() {
  game.settings.register(MODULE_ID, 'mercadorAtivo', {
    name: 'Mercador ativo',
    hint: 'Ator cujo inventário é o estoque da loja. Vazio: loja geral, sem limite de estoque.',
    scope: 'world',
    config: false,
    type: String,
    default: '',
    onChange: () => rerenderVitrines(),
  });

  // Qualquer mudança no inventário do mercador ativo atualiza as vitrines
  // de todos — a última unidade comprada por um some da tela do outro.
  const aoMudarItem = item => {
    const dono = item?.parent;
    if (dono?.documentName !== 'Actor') return;
    if (dono.id !== idMercadorAtivo()) return;
    rerenderVitrinesDebounced();
  };
  Hooks.on('createItem', aoMudarItem);
  Hooks.on('updateItem', aoMudarItem);
  Hooks.on('deleteItem', aoMudarItem);

  Hooks.on('updateActor', (actor, data) => {
    if (!foundry.utils.hasProperty(data, `flags.${MODULE_ID}`)
      && !foundry.utils.hasProperty(data, `flags.-=${MODULE_ID}`)) return;
    rerenderVitrinesDebounced();
  });
  Hooks.on('deleteActor', actor => {
    if (actor.id === idMercadorAtivo()) rerenderVitrinesDebounced();
  });

  // Botão direito num ator do diretório: marcar/desmarcar como mercador.
  Hooks.on('getActorContextOptions', (_app, opcoes) => {
    const atorDe = li => {
      const el = li?.[0] ?? li;
      const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
      return id ? game.actors.get(id) : null;
    };
    opcoes.push(
      {
        name: 'Tornar mercador da loja',
        icon: '<i class="fas fa-store"></i>',
        condition: li => game.user.isGM && !ehMercador(atorDe(li)),
        callback: async li => {
          const ator = atorDe(li);
          if (!ator) return;
          await ator.setFlag(MODULE_ID, FLAG_MERCADOR, true);
          ui.notifications.info(`${ator.name} agora é um mercador. Escolha-o como estoque no topo da loja.`);
        },
      },
      {
        name: 'Deixar de ser mercador da loja',
        icon: '<i class="fas fa-store-slash"></i>',
        condition: li => game.user.isGM && ehMercador(atorDe(li)),
        callback: async li => {
          const ator = atorDe(li);
          if (!ator) return;
          if (ator.id === idMercadorAtivo()) await game.settings.set(MODULE_ID, 'mercadorAtivo', '');
          await ator.unsetFlag(MODULE_ID, FLAG_MERCADOR);
        },
      },
    );
  });
}
