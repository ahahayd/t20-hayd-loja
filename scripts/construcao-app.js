/**
 * ConstrucaoApplication — planejador de construção da Loja.
 *
 * Com "Planejar construção" marcado na loja, o martelo de cada item manda o
 * item para esta janela em vez de fabricá-lo na hora. Aqui o jogador monta a
 * lista (itens, magias como poção/pergaminho e aprimoramentos de itens que já
 * existem), ajusta linha por linha teste, CD, fração, tempo e lote, e conclui
 * tudo de uma vez: rola os testes, cobra, entrega os itens e publica um cartão
 * só no chat.
 *
 * As contas ficam em construcao-regras.mjs; aqui só há Foundry, ficha e tela.
 *
 * A lista e as preferências moram em flags do ator, então cada ficha tem as
 * suas e o plano sobrevive a fechar a loja. Editar um campo não re-renderiza a
 * janela: os números são reescritos no lugar, para não perder foco nem rolagem.
 *
 * Testes: cada lote é um teste. Concluir tem duas etapas. Primeiro os testes
 * são rolados (um a um, com a janela de uso do sistema, ou todos direto), cada
 * um com sua mensagem no chat, onde sucesso e falha podem ser trocados. Essa
 * "sessão" fica salva no ator e trava a lista. Finalizar é que cobra, entrega
 * e publica o relatório, e a lista recomeça vazia. Falhar não entrega o lote;
 * o tempo é gasto e o material depende de "Falha gasta o material".
 *
 * A mensagem é a fonte da verdade do resultado: trocar só atualiza a flag dela
 * e o hook updateChatMessage leva a mudança para a janela aberta. No fim, um
 * único updateDocuments tira os botões de todas de uma vez.
 */

import { MODULE_ID, pisoDaJanela, observarLargura } from './main.js';
import { ehV14 } from './versao.mjs';
import {
  debitarCarteira, cartaoLoja, linhaCartao, moedasChips, atorUsaPlatina,
  linhaPagamento, getChatRecipients, toCobre,
} from './shop-app.js';
import { AprimorarApplication, aplicarAprimoramento, detectarExistentes, formatarCusto } from './aprimorar-app.js';
import {
  CATEGORIAS, FRACOES, MULTIPLICADORES, FRACAO_PADRAO, OFICIO_ESCRIBA, UNIDADES_REDUCAO, UNIDADES_TEMPO,
  ajusteCdDaDescricao, calcularLinha, categoria, categoriaDoItem, formatarTempo, modificadorDoTeste,
  penalidadesDoTeste, pmDoPreco, prefsCompletas, prefsPadrao, resumirPlano, sugestoes,
} from './construcao-regras.mjs';

const FLAG_PLANO = 'construcaoPlano';
const FLAG_PREFS = 'construcaoPrefs';
const FLAG_SESSAO = 'construcaoSessao';
const FLAG_TESTE = 'construcaoTeste';
const ITENS_ID = 't20-hayd-itens';
const ESPERA_GRAVACAO_MS = 500;

const RE_OFICIO_DA_FICHA = /^ofi[1-9]$/;
const RE_ESCRIBA = /escriba/i;

function esc(texto) {
  return foundry.utils.escapeHTML(String(texto ?? ''));
}

function comSinal(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Todas as perícias do ator, inclusive os ofi1..ofi9 criados na ficha. */
function periciasDoAtor(actor) {
  return Object.entries(actor.system?.pericias ?? {})
    .map(([k, p]) => ({
      chave: k,
      rotulo: p.label ?? k,
      valor: Number(p.value) || 0,
      // Só o que exige treino avisa; em Atletismo "sem treino" não diz nada.
      semTreino: !p.treinado && (RE_OFICIO_DA_FICHA.test(k) || !!CONFIG.T20?.pericias?.[k]?.trainedOnly),
    }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/** "escriba" vira o ofício criado na ficha; sem ele, fica a chave genérica. */
function resolverOficio(chave, oficios) {
  if (chave !== OFICIO_ESCRIBA) return chave;
  return oficios.find(o => RE_ESCRIBA.test(o.rotulo))?.chave ?? OFICIO_ESCRIBA;
}

function opcoesDeOficio(selecionado, oficios) {
  const opcoes = oficios.map(o => ({
    valor: o.chave,
    rotulo: `${o.rotulo} ${comSinal(o.valor)}${o.semTreino ? ' (sem treino)' : ''}`,
    selecionado: o.chave === selecionado,
  }));
  if (!oficios.some(o => RE_ESCRIBA.test(o.rotulo))) {
    opcoes.push({
      valor: OFICIO_ESCRIBA,
      rotulo: 'Ofício: Escriba (fora da ficha)',
      selecionado: selecionado === OFICIO_ESCRIBA,
    });
  }
  return opcoes;
}

function opcoes(lista, selecionado, rotulo = v => v) {
  return lista.map(v => ({ valor: v, rotulo: rotulo(v), selecionado: v === selecionado }));
}

const opcoesDeTempo = selecionado => UNIDADES_TEMPO.map(u => ({
  valor: u.valor, rotulo: u.plural, selecionado: u.valor === selecionado,
}));

const opcoesDeReducao = selecionado => UNIDADES_REDUCAO.map(u => ({
  valor: u.valor, rotulo: u.rotulo, selecionado: u.valor === selecionado,
}));

/** Mensagem de um teste: `pendente` enquanto rola, `ativo` com o botão de trocar. */
function cartaoDoTeste(ator, t, { pendente = false, ativo = false, situacao = '' } = {}) {
  const resultado = pendente
    ? '<small class="t20l-nulo">Rolando…</small>'
    : `<span class="t20l-cons-res ${t.passou ? 't20l-cons-ok' : 't20l-cons-falha'}">${t.total}</span>
       <b>${t.passou ? 'Sucesso' : 'Falha'}</b>${t.trocado ? ' <small>(alterado)</small>' : ''}
       ${t.formula ? `<small>${esc(t.formula)}${t.mod ? ` ${comSinal(t.mod)}` : ''}</small>` : ''}
       ${situacao ? `<small class="t20l-nulo">(${situacao})</small>` : ''}`;
  return cartaoLoja({
    icone: 'fa-dice-d20',
    titulo: `teste ${t.n} de ${t.de} da construção`,
    ator,
    corpo: `
      <div class="t20l-item t20l-compacto"><img src="${t.img}" alt="" />${esc(t.nome)} <em>×${t.unidades}</em></div>
      ${linhaCartao('Teste', `${esc(t.pericia)} · CD ${t.cd}`)}
      ${linhaCartao('Resultado', resultado)}
      ${ativo ? `<button type="button" class="t20l-cons-trocar"><i class="fas fa-exchange-alt"></i> Trocar sucesso/falha</button>` : ''}`,
  });
}

async function trocarNaMensagem(mensagem) {
  const t = foundry.utils.deepClone(mensagem.getFlag(MODULE_ID, FLAG_TESTE));
  if (!t) return;
  t.passou = !t.passou;
  t.trocado = !t.trocado;
  await mensagem.update({
    content: cartaoDoTeste(mensagem.speaker?.alias, t, { ativo: true }),
    [`flags.${MODULE_ID}.${FLAG_TESTE}`]: t,
  });
}

Hooks.once('ready', () => {
  // Delegado no documento: vale para o chat e para mensagens destacadas, sem
  // hook de render, que muda de nome entre versões do Foundry.
  document.addEventListener('click', ev => {
    const botao = ev.target.closest?.('.t20l-cons-trocar');
    if (!botao) return;
    const mensagem = game.messages.get(botao.closest('[data-message-id]')?.dataset.messageId);
    if (!mensagem) return;
    if (!mensagem.isAuthor && !game.user.isGM) return ui.notifications.warn('Só quem rolou ou o mestre pode trocar.');
    trocarNaMensagem(mensagem);
  });
});

Hooks.on('updateChatMessage', mensagem => {
  const t = mensagem.getFlag(MODULE_ID, FLAG_TESTE);
  if (!t) return;
  const janela = Object.values(ui.windows).find(w => w instanceof ConstrucaoApplication && w._sessao?.id === t.sessao);
  janela?.receberTroca(t);
});

/**
 * Efeito de uso temporário de uma penalidade. Mora na ficha só durante o
 * teste: é assim que o sistema o lista, já marcado, na janela de uso e o
 * soma na fórmula. v13: flags `tormenta20` (`skill` na janela, `pericia` na
 * rolagem direta). v14: `system.abilityUse` e mudança com `type`.
 */
function efeitoDaPenalidade({ nome, valor }, pericia) {
  const base = { name: `${nome} (${String(valor).replace('-', '–')})`, img: 'icons/svg/downgrade.svg', transfer: false };
  if (ehV14()) {
    return {
      ...base,
      system: {
        onuse: true,
        abilityUse: { types: ['skill'], names: [pericia], automatic: true },
        changes: [{ key: 'roll', type: 'add', value: String(valor) }],
      },
    };
  }
  return {
    ...base,
    changes: [{ key: 'roll', mode: 2, value: String(valor) }],
    flags: { tormenta20: { onuse: true, skill: true, pericia: true, items: pericia } },
  };
}

/** PM da ficha, com os temporários à parte: é deles que o sistema gasta primeiro. */
function pmDoAtor(actor) {
  const pm = actor.system?.attributes?.pm ?? {};
  return { valor: Number(pm.value) || 0, temp: Number(pm.temp) || 0 };
}

/**
 * Efeitos de uso da ficha que valem para qualquer perícia, sem restrição de
 * nome, com bônus numérico. v13: flags `tormenta20` nos efeitos do ator. v14:
 * `system.abilityUse`, em qualquer documento do ator; os automáticos ficam de
 * fora porque o sistema já os aplica sozinho.
 */
function efeitosGlobais(actor) {
  const dados = actor.getRollData();
  const bonusDe = changes => (changes ?? [])
    .filter(ch => ['roll', 'ataque'].includes(ch.key))
    .reduce((soma, ch) => {
      const valor = Number(Roll.replaceFormulaData(String(ch.value), dados, { missing: '0' }).replace(/\s/g, '').replace(/^\+/, ''));
      return soma + (Number.isFinite(valor) ? valor : NaN);
    }, 0);

  const lista = [];
  if (ehV14()) {
    for (const [, doc] of actor.traverseEmbeddedDocuments()) {
      if (doc.documentName !== 'ActiveEffect' || !doc.system?.onuse) continue;
      const uso = doc.system.abilityUse;
      if (!uso?.types?.has('skill') || uso.names?.size || uso.automatic) continue;
      lista.push({ id: doc.id, nome: doc.name, custo: Number(uso.custo) || 0, bonus: bonusDe(doc.system.changes) });
    }
  } else {
    for (const ef of actor.effects) {
      const f = ef.flags?.tormenta20;
      if (!f?.onuse || !f.skill || f.items) continue;
      lista.push({ id: ef.id, nome: ef.name, custo: Number(f.custo) || 0, bonus: bonusDe(ef.changes) });
    }
  }
  return lista.filter(e => Number.isFinite(e.bonus) && e.bonus !== 0);
}

export class ConstrucaoApplication extends Application {
  constructor(shopApp, options = {}) {
    super(options);
    this.shopApp = shopApp;
    this.actor = shopApp.actor;
    this._aba = 'plano';
    this._prefs = prefsCompletas(this.actor.getFlag(MODULE_ID, FLAG_PREFS));
    this._linhas = foundry.utils.deepClone(this.actor.getFlag(MODULE_ID, FLAG_PLANO) ?? []);
    this._sessao = foundry.utils.deepClone(this.actor.getFlag(MODULE_ID, FLAG_SESSAO) ?? null);
    this._sincronizarSessao();
    this._timerGravacao = null;
    this._concluindo = false;
  }

  /** Trocas feitas com a janela fechada estão nas mensagens. */
  _sincronizarSessao() {
    for (const t of this._sessao?.testes ?? []) {
      const salvo = game.messages.get(t.mensagemId)?.getFlag(MODULE_ID, FLAG_TESTE);
      if (salvo) Object.assign(t, { passou: salvo.passou, trocado: salvo.trocado });
    }
  }

  receberTroca({ id, passou, trocado }) {
    const t = this._sessao?.testes.find(x => x.id === id);
    if (!t) return;
    Object.assign(t, { passou, trocado });
    this._gravarSessao();
    if (this.rendered && !this._concluindo) this.render();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `t20-loja-construcao-${foundry.utils.randomID(4)}`,
      title: 'Planejar construção',
      template: `modules/${MODULE_ID}/templates/construcao.hbs`,
      width: 800,
      height: 640,
      resizable: true,
      classes: ['t20-loja-window', 't20-loja-construcao'],
      scrollY: ['.cons-lista', '.cons-prefs-corpo'],
    });
  }

  /** Piso mínimo do redimensionamento (ver pisoDaJanela em main.js). */
  static PISO = { width: 560, height: 420 };

  setPosition(posicao = {}) {
    return pisoDaJanela(this, super.setPosition, posicao, ConstrucaoApplication.PISO);
  }

  async close(options = {}) {
    if (this._timerGravacao) await this._gravarPlano();
    this._observadorLargura?.disconnect();
    this._observadorLargura = null;
    await this._aprimorarApp?.close();
    this._aprimorarApp = null;
    const fechou = await super.close(options);
    if (!options.pelaLoja) this.shopApp.construcaoFechada();
    return fechou;
  }

  /* ── Dados ─────────────────────────────────── */

  /** Mês e horas por dia são configuração do mundo, não da ficha. */
  _aplicarRegrasDoMundo() {
    this._prefs.diasNoMes = Number(game.settings.get(MODULE_ID, 'construcaoDiasNoMes')) || 30;
    this._prefs.horasPorDia = Number(game.settings.get(MODULE_ID, 'construcaoHorasPorDia')) || 8;
  }

  getData() {
    this._aplicarRegrasDoMundo();
    const oficios = periciasDoAtor(this.actor);
    const testes = this._sessao?.testes ?? [];
    return {
      sessao: this._sessao ? {
        testes,
        sucessos: testes.filter(t => t.passou).length,
        falhas: testes.filter(t => !t.passou).length,
      } : null,
      abaPlano: this._aba === 'plano',
      linhas: this._linhas.map(linha => this._linhaNaTela(linha, oficios)),
      totalLinhas: this._linhas.length,
      prefs: this._prefsNaTela(oficios),
    };
  }

  _linhaNaTela(linha, oficios) {
    const cat = categoria(linha.categoria);
    return {
      ...linha,
      opcoesCategoria: CATEGORIAS.map(c => ({ valor: c.id, rotulo: c.nome, selecionado: c.id === linha.categoria })),
      opcoesOficio: opcoesDeOficio(linha.oficio, oficios),
      opcoesFracao: opcoes(FRACOES, linha.fracao),
      opcoesTempo: opcoesDeTempo(linha.tempoUnidade),
      opcoesReducao: opcoesDeReducao(linha.reducaoUnidade),
      cdAutomatica: !!cat.usaPm,
      podeQuantidade: linha.tipo !== 'aprimorar' || linha.maxCrafts > 1,
      podeLote: !!cat.consumivel && linha.tipo !== 'aprimorar',
      podeMultiplicar: !!cat.consumivel && linha.tipo !== 'aprimorar',
      opcoesMult: opcoes(MULTIPLICADORES, Number(linha.multDoses) || 1, v => `×${v}`),
      rotuloLote: `–5 no teste: ×${cat.porLote} unidades`,
      temPacote: linha.pacote > 1,
    };
  }

  _prefsNaTela(oficios) {
    const prefs = this._prefs;
    const sem = Array.isArray(prefs.semInstrumentos) ? prefs.semInstrumentos : [];
    const deOficio = oficios.filter(o => CONFIG.T20?.oficios?.has(o.chave) || RE_OFICIO_DA_FICHA.test(o.chave));
    const instrumentos = deOficio.map(o => ({ chave: o.chave, rotulo: o.rotulo.replace(/^Ofício:\s*/, ''), tem: !sem.includes(o.chave) }));
    if (!oficios.some(o => RE_ESCRIBA.test(o.rotulo))) {
      instrumentos.push({ chave: OFICIO_ESCRIBA, rotulo: 'Escriba', tem: !sem.includes(OFICIO_ESCRIBA) });
    }
    return {
      ...prefs,
      instrumentos,
      opcoesMult: opcoes(MULTIPLICADORES, Number(prefs.multDoses) || 1, v => `×${v}`),
      opcoesReducao: opcoesDeReducao(prefs.reducaoUnidade),
      categorias: CATEGORIAS.map(c => {
        const p = prefs.categorias[c.id];
        return {
          ...p,
          id: c.id,
          nome: c.nome,
          usaPm: !!c.usaPm,
          opcoesOficio: opcoesDeOficio(resolverOficio(p.oficio, oficios), oficios),
          opcoesFracao: opcoes(FRACOES, p.fracao),
          opcoesTempo: opcoesDeTempo(p.tempoUnidade),
        };
      }),
    };
  }

  /* ── Montagem das linhas ───────────────────── */

  _novaLinha(dados) {
    const linha = {
      id: foundry.utils.randomID(),
      qtd: 1,
      pacote: 1,
      desconto: 0,
      gastaTempo: true,
      nMelhorias: 0,
      nEncantos: 0,
      superior: false,
      pm: 0,
      ajusteCd: 0,
      detalhe: '',
      fracao: FRACAO_PADRAO,
      reducaoValor: this._prefs.reducaoValor,
      reducaoUnidade: this._prefs.reducaoUnidade,
      ...dados,
    };
    this._aplicarSugestoes(linha);
    return linha;
  }

  _aplicarSugestoes(linha) {
    // Item que passou a ser poção/pergaminho pela categoria: o PM sai do preço.
    if (categoria(linha.categoria).usaPm && !linha.pm) linha.pm = pmDoPreco(linha.preco);
    Object.assign(linha, sugestoes(linha, this._prefs));
    linha.oficio = resolverOficio(linha.oficio, periciasDoAtor(this.actor));
    if (linha.tipo === 'aprimorar') {
      linha.lote = false;
      linha.multDoses = 1;
      linha.qtd = 1;
    }
  }

  _adicionar(linha) {
    if (this._sessao) return ui.notifications.warn('Finalize ou descarte os testes rolados antes de mudar a lista.');
    this._linhas.push(linha);
    this._agendarGravacao();
    if (this.rendered) this.render();
  }

  /** Item comum da vitrine. */
  async adicionarItem(uuid) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) return ui.notifications.error('Item não encontrado no compêndio.');
    const { m, e } = detectarExistentes(doc);
    const magico = e > 0 || !!doc.flags?.[ITENS_ID]?.magico || String(doc.uuid).includes('equipamentos-magicos');
    const preco = Number(doc.system?.preco) || 0;
    const idCategoria = categoriaDoItem(doc, { magico });
    this._adicionar(this._novaLinha({
      tipo: 'item',
      uuid: doc.uuid,
      nome: doc.name,
      img: doc.img,
      preco,
      // Munição é vendida em pacotes (Flechas: 20 por T$ 1).
      pacote: Math.max(1, Number(doc.system?.qtd) || 1),
      categoria: idCategoria,
      nMelhorias: m,
      nEncantos: e,
      superior: m > 0 || magico,
      pm: categoria(idCategoria).usaPm ? pmDoPreco(preco) : 0,
      ajusteCd: ajusteCdDaDescricao(doc),
    }));
  }

  /** Magia já resolvida na loja: forma, aprimoramentos e item pronto. */
  adicionarMagia({ uuid, forma, pm, subtipo, dedupeKey, itemData, unitPrice }) {
    this._adicionar(this._novaLinha({
      tipo: 'magia',
      uuid,
      nome: itemData.name,
      img: itemData.img,
      preco: unitPrice,
      categoria: forma === 'pergaminho' ? 'pergaminho' : 'pocao',
      pm,
      detalhe: `${subtipo} · ${pm} PM`,
      magia: { forma, subtipo, dedupeKey, itemData: foundry.utils.deepClone(itemData) },
    }));
  }

  /** Volta da janela de Itens Superiores: item existente ou da loja, com entradas novas. */
  adicionarAprimoramento(alvo, calc) {
    if (alvo.id && this._linhas.some(l => l.aprimorar?.alvo.id === alvo.id)) {
      return ui.notifications.warn(`${alvo.nomeOriginal} já está na lista. Remova a linha para refazer as escolhas.`);
    }
    const valorItem = alvo.origem === 'loja' ? alvo.preco : 0;
    const { doc, ...alvoSemDocumento } = alvo;
    this._adicionar(this._novaLinha({
      tipo: 'aprimorar',
      uuid: alvo.uuid,
      nome: alvo.nomeOriginal,
      img: alvo.img,
      preco: Math.round((valorItem + calc.aumento) * calc.qtd * 100) / 100,
      categoria: categoriaDoItem(doc),
      nMelhorias: calc.totalM,
      nEncantos: calc.totalE,
      superior: true,
      detalhe: `+ ${calc.sel.map(s => s.nome).join(', ')}`,
      // Pilha do inventário: dá para aprimorar só parte dela, uma unidade por craft.
      maxCrafts: alvo.separar ? Number(doc.system?.qtd) || 1 : 1,
      aprimorar: {
        alvo: alvoSemDocumento,
        calc: {
          sel: foundry.utils.deepClone(calc.sel),
          precoFinal: calc.precoFinal,
          totalM: calc.totalM,
          totalE: calc.totalE,
          qtd: calc.qtd,
        },
      },
    }));
  }

  /* ── Persistência ──────────────────────────── */

  _agendarGravacao() {
    clearTimeout(this._timerGravacao);
    this._timerGravacao = setTimeout(() => this._gravarPlano(), ESPERA_GRAVACAO_MS);
  }

  /** `render: false`: o plano não muda nada que a ficha mostre. */
  _gravarPlano() {
    clearTimeout(this._timerGravacao);
    this._timerGravacao = null;
    return this.actor.update(
      { [`flags.${MODULE_ID}.${FLAG_PLANO}`]: foundry.utils.deepClone(this._linhas) },
      { render: false },
    );
  }

  _gravarSessao() {
    return this.actor.update(
      { [`flags.${MODULE_ID}.${FLAG_SESSAO}`]: foundry.utils.deepClone(this._sessao) },
      { render: false },
    );
  }

  _gravarPrefs() {
    return this.actor.update(
      { [`flags.${MODULE_ID}.${FLAG_PREFS}`]: foundry.utils.deepClone(this._prefs) },
      { render: false },
    );
  }

  /* ── Tela ──────────────────────────────────── */

  _saldoCobre() {
    const w = this.shopApp._wealthInfo();
    return toCobre(w.to, w.tp, w.tc);
  }

  _atualizarLinha(html, linha) {
    const el = html.find(`.cons-linha[data-id="${linha.id}"]`);
    const conta = calcularLinha(linha, this._prefs);
    const testes = conta.lotes.length;
    el.find('.cons-l-custo').text(formatarCusto(conta.custoCobre));
    el.find('.cons-l-tempo').text(formatarTempo(conta.tempoHoras, this._prefs));
    el.find('.cons-l-testes').text(`${testes} teste${testes === 1 ? '' : 's'}`);
    const porCraft = conta.lotes[0];
    el.find('.cons-l-unidades').text(`${conta.unidades} unidade${conta.unidades === 1 ? '' : 's'}`);
    el.find('.cons-l-formula').text(`${testes} craft${testes === 1 ? '' : 's'} × ${porCraft} por craft`);
    const mod = modificadorDoTeste(this._prefs, linha);
    el.find('.cons-l-mod').text(mod ? `${comSinal(mod).replace('-', '–')} em cada teste` : 'Sem penalidade');
    el.find('.cons-l-unitario').text(`${formatarCusto(conta.unitarioCobre)} por unidade`);
    el.find('input[data-campo="cd"]').toggleClass('cons-falta', linha.cd === null);
  }

  _atualizarTotais(html) {
    const resumo = resumirPlano(this._linhas, this._prefs);
    const saldo = this._saldoCobre();
    html.find('.cons-t-custo').text(formatarCusto(resumo.custoCobre)).toggleClass('too-expensive', resumo.custoCobre > saldo);
    html.find('.cons-t-tempo').text(formatarTempo(resumo.tempoHoras, this._prefs));
    html.find('.cons-t-testes').text(resumo.testes);
    html.find('.cons-t-saldo').text(formatarCusto(saldo));
    html.find('.cons-concluir').prop('disabled', !this._linhas.length);
  }

  /** Dinheiro mudou por fora (compra em outra janela, ajuste na ficha). */
  atualizarSaldo() {
    if (this.rendered) this._atualizarTotais(this.element);
  }

  _atualizarTudo(html) {
    for (const linha of this._linhas) this._atualizarLinha(html, linha);
    this._atualizarTotais(html);
  }

  /* ── Listeners ─────────────────────────────── */

  activateListeners(html) {
    super.activateListeners(html);
    // Como a de Itens Superiores, esta janela é um formulário de trabalho:
    // segue a base visual da família, não o tema da vitrine.
    observarLargura(this);

    html.find('.cons-aba').on('click', ev => {
      this._aba = ev.currentTarget.dataset.aba;
      html.find('.cons-aba').removeClass('active');
      ev.currentTarget.classList.add('active');
      html.find('[data-painel]').each((_, el) => { el.hidden = el.dataset.painel !== this._aba; });
    });

    html.find('.cons-aprimorar').on('click', () => this._abrirAprimorar());

    const lista = html.find('.cons-lista');
    lista.on('input', 'input[type="number"][data-campo]', ev => this._editarCampo(ev.currentTarget, html));
    lista.on('change', 'select[data-campo], input[type="checkbox"][data-campo]', ev => this._editarCampo(ev.currentTarget, html));
    lista.on('click', '.cons-remover', ev => {
      const id = ev.currentTarget.closest('.cons-linha').dataset.id;
      this._linhas = this._linhas.filter(l => l.id !== id);
      this._agendarGravacao();
      this.render();
    });

    html.find('.cons-esvaziar').on('click', () => {
      this._linhas = [];
      this._agendarGravacao();
      this.render();
    });

    lista.on('click', '.cons-resultado', ev => this._trocarResultado(ev.currentTarget.dataset.id));
    html.find('.cons-finalizar').on('click', ev => {
      ev.currentTarget.disabled = true;
      this._finalizar(this._sessao.testes).catch(err => {
        console.error(`${MODULE_ID} | Falha ao finalizar a construção`, err);
        ui.notifications.error('Falha ao finalizar a construção. Veja o console (F12).');
      });
    });
    html.find('.cons-descartar').on('click', () => this._descartarSessao());

    html.find('.cons-concluir:not(.cons-finalizar)').on('click', ev => {
      const botao = ev.currentTarget;
      botao.disabled = true;
      this._concluir().catch(err => {
        console.error(`${MODULE_ID} | Falha ao concluir a construção`, err);
        ui.notifications.error('Falha ao concluir a construção. Veja o console (F12).');
      }).finally(() => { if (this.rendered) botao.disabled = !this._linhas.length; });
    });

    const prefs = html.find('.cons-prefs');
    prefs.on('change', '[data-cat]', ev => this._editarPrefCategoria(ev.currentTarget));
    prefs.on('change', '[data-instrumento]', ev => {
      const { instrumento } = ev.currentTarget.dataset;
      const sem = new Set(Array.isArray(this._prefs.semInstrumentos) ? this._prefs.semInstrumentos : []);
      if (ev.currentTarget.checked) sem.delete(instrumento); else sem.add(instrumento);
      this._prefs.semInstrumentos = [...sem];
      this._gravarPrefs();
      this._atualizarTudo(html);
    });
    prefs.on('change', '[data-geral]', ev => this._editarPrefGeral(ev.currentTarget, html));
    prefs.on('click', '.cons-restaurar', () => {
      this._prefs = prefsPadrao();
      this._gravarPrefs();
      this.render();
    });

    this._atualizarTudo(html);
  }

  _abrirAprimorar() {
    if (!this._aprimorarApp?.rendered) this._aprimorarApp = new AprimorarApplication(this.shopApp, {}, this);
    this._aprimorarApp.render(true);
  }

  _editarCampo(el, html) {
    const linha = this._linhas.find(l => l.id === el.closest('.cons-linha').dataset.id);
    if (!linha) return;
    const campo = el.dataset.campo;

    switch (campo) {
      case 'categoria':
        linha.categoria = el.value;
        this._aplicarSugestoes(linha);
        this._agendarGravacao();
        return this.render();
      case 'gastaTempo':
        linha.gastaTempo = el.checked;
        break;
      case 'lote':
        linha.lote = el.checked;
        break;
      case 'multDoses':
        linha.multDoses = Number(el.value) || 1;
        break;
      case 'qtd':
        linha.qtd = Math.max(1, Math.floor(Number(el.value) || 1));
        if (linha.tipo === 'aprimorar') {
          linha.qtd = Math.min(linha.qtd, linha.maxCrafts ?? 1);
          if (Number(el.value) > linha.qtd) el.value = linha.qtd;
        }
        break;
      case 'cd':
        linha.cd = el.value === '' ? null : Number(el.value);
        break;
      case 'tempoValor':
      case 'reducaoValor':
      case 'desconto':
        linha[campo] = Math.max(0, Number(el.value) || 0);
        break;
      default:
        linha[campo] = el.value;
    }

    this._atualizarLinha(html, linha);
    this._atualizarTotais(html);
    this._agendarGravacao();
  }

  _editarPrefCategoria(el) {
    const { cat, campo } = el.dataset;
    const alvo = this._prefs.categorias[cat];
    if (campo === 'cd') alvo.cd = el.value === '' ? null : Number(el.value);
    else if (campo === 'tempoValor') alvo.tempoValor = Math.max(0, Number(el.value) || 0);
    else alvo[campo] = el.value;
    this._gravarPrefs();
  }

  _editarPrefGeral(el, html) {
    const campo = el.dataset.geral;
    if (el.type === 'checkbox') this._prefs[campo] = el.checked;
    else if (el.type === 'number' || campo === 'multDoses') this._prefs[campo] = Math.max(0, Number(el.value) || 0);
    else this._prefs[campo] = el.value;
    this._gravarPrefs();
    this._atualizarTudo(html);
  }

  /* ── Conclusão ─────────────────────────────── */

  /** Cada linha tem de ter de onde sair antes de qualquer dado rolar. */
  async _linhasIndisponiveis() {
    const faltando = [];
    for (const linha of this._linhas) {
      if (linha.tipo === 'magia') continue;
      const alvo = linha.aprimorar?.alvo;
      const existe = alvo?.origem === 'inventario'
        ? this.actor.items.has(alvo.id)
        : !!(await fromUuid(linha.uuid).catch(() => null));
      if (!existe) faltando.push(linha.nome);
    }
    return faltando;
  }

  async _concluir() {
    if (this._concluindo || !this._linhas.length) return;

    const prefs = this._prefs;
    const resumo = resumirPlano(this._linhas, prefs);
    const wealth = this.shopApp._wealthInfo();
    if (toCobre(wealth.to, wealth.tp, wealth.tc) < resumo.custoCobre) {
      return ui.notifications.warn(`${this.actor.name} não tem moedas suficientes para esta lista.`);
    }
    if (prefs.rolarTestes && this._linhas.some(l => l.cd === null)) {
      return ui.notifications.warn('Defina a CD dos itens marcados antes de concluir.');
    }
    const faltando = await this._linhasIndisponiveis();
    if (faltando.length) {
      return ui.notifications.error(`Não encontrei: ${faltando.join(', ')}. Remova da lista para continuar.`);
    }

    const escolha = await this._perguntarModo(resumo);
    if (!escolha) return;
    const { modo, globais } = escolha;

    this._concluindo = true;
    try {
      if (modo === 'sem') return await this._finalizar([]);
      await this._rolarSessao(modo === 'janela', globais);
    } finally {
      this._concluindo = false;
    }
    if (this.rendered) this.render();
  }

  _perguntarModo(resumo) {
    const prefs = this._prefs;
    const texto = `Gastar até <strong>${formatarCusto(resumo.custoCobre)}</strong>
      e <strong>${formatarTempo(resumo.tempoHoras, prefs)}</strong>${prefs.rolarTestes
        ? `, com <strong>${resumo.testes}</strong> teste${resumo.testes === 1 ? '' : 's'}` : ''}?`;
    return new Promise(fim => {
      // O Dialog chama `close` depois de qualquer botão; ao seguir para os
      // efeitos de uso, quem responde é o diálogo seguinte.
      let seguiu = false;
      const buttons = prefs.rolarTestes ? {
        janela: { icon: '<i class="fas fa-sliders-h"></i>', label: 'Rolar um a um', callback: () => fim({ modo: 'janela', globais: [] }) },
        todos: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: 'Rolar todos os testes',
          callback: () => {
            seguiu = true;
            this._perguntarGlobais(resumo).then(fim);
          },
        },
      } : {
        sem: { icon: '<i class="fas fa-check"></i>', label: 'Concluir', callback: () => fim({ modo: 'sem', globais: [] }) },
      };
      new Dialog({
        title: 'Concluir construção',
        content: `<div class="t20-loja-craft-dialog"><p>${texto}</p>${prefs.rolarTestes
          ? '<p>Um a um abre a janela de uso em cada teste, para somar bônus. Rolar todos usa o método padrão.</p>' : ''}</div>`,
        buttons,
        close: () => { if (!seguiu) fim(null); },
      }).render(true);
    });
  }

  /** Depois de "Rolar todos": efeitos globais da ficha. Sem nenhum, rola direto. */
  _perguntarGlobais(resumo) {
    const globais = efeitosGlobais(this.actor);
    if (!globais.length) return Promise.resolve({ modo: 'todos', globais: [] });
    const escolhidos = html => globais.filter(g => html.find(`input[data-global="${g.id}"]`).prop('checked'));
    const { valor, temp } = pmDoAtor(this.actor);
    const disponivel = valor + temp;
    const custoTotal = lista => lista.reduce((s, g) => s + g.custo, 0) * resumo.testes;
    const previa = lista => {
      const bonus = lista.reduce((s, g) => s + g.bonus, 0);
      const pm = custoTotal(lista);
      const falta = pm > disponivel ? ` (${this.actor.name} tem ${disponivel})` : '';
      return lista.length ? `${comSinal(bonus)} em cada teste · ${pm} PM no total${falta}` : 'Nenhum efeito marcado';
    };
    const atualizar = html => {
      const lista = escolhidos(html);
      const semPm = custoTotal(lista) > disponivel;
      html.find('.cons-previa-global').text(previa(lista)).toggleClass('cons-previa-falta', semPm);
      html.closest('.window-app').find('button[data-button="rolar"]').prop('disabled', semPm);
    };
    return new Promise(fim => {
      new Dialog({
        title: 'Rolar todos os testes',
        content: `<div class="t20-loja-craft-dialog">
          <p><strong>Efeitos de uso em todos os testes</strong></p>
          ${globais.map(g => `<label class="checkbox"><input type="checkbox" data-global="${g.id}"> ${esc(g.nome)} (${comSinal(g.bonus)}, ${g.custo} PM por teste)</label>`).join('')}
          <p class="cons-previa-global">${previa([])}</p>
        </div>`,
        buttons: {
          rolar: { icon: '<i class="fas fa-dice-d20"></i>', label: 'Rolar', callback: html => fim({ modo: 'todos', globais: escolhidos(html) }) },
        },
        default: 'rolar',
        render: html => html.find('[data-global]').on('change', () => atualizar(html)),
        close: () => fim(null),
      }).render(true);
    });
  }

  /** Rolagem sem cartão do sistema; `comJanela` abre a janela de uso. Cancelar devolve undefined. */
  async _rolarTeste(chave, comJanela) {
    if (!this.actor.system?.pericias?.[chave]) {
      // Ofício que não está na ficha: teste sem treino, atributo + metade do nível.
      const inteligencia = Number(this.actor.system?.atributos?.int?.value) || 0;
      const metadeNivel = Math.floor((Number(this.actor.system?.attributes?.nivel?.value) || 0) / 2);
      return new Roll('1d20 + @bonus', { bonus: inteligencia + metadeNivel }).evaluate();
    }
    // O sistema abre a janela sem shift no modo padrão e com shift no invertido.
    const padrao = game.settings.get('tormenta20', 'UsageConfig') === 'default';
    return this.actor.rollPericia(chave, { message: false, event: { shiftKey: comJanela ? !padrao : padrao } });
  }

  /** Um registro por lote, na ordem da lista. */
  _montarTestes(sessaoId) {
    const testes = [];
    for (const linha of this._linhas) {
      const { lotes } = calcularLinha(linha, this._prefs);
      for (const unidades of lotes) {
        testes.push({
          id: foundry.utils.randomID(),
          sessao: sessaoId,
          linhaId: linha.id,
          nome: linha.nome,
          img: linha.img,
          unidades,
          pericia: this.actor.system?.pericias?.[linha.oficio]?.label ?? 'Ofício: Escriba',
          chave: linha.oficio,
          cd: linha.cd,
          mod: modificadorDoTeste(this._prefs, linha),
          penalidades: penalidadesDoTeste(this._prefs, linha),
        });
      }
    }
    testes.forEach((t, i) => Object.assign(t, { n: i + 1, de: testes.length }));
    return testes;
  }

  async _rolarSessao(comJanela, globais = []) {
    const bonusGlobal = globais.reduce((s, g) => s + g.bonus, 0);
    const chat = game.settings.get(MODULE_ID, 'enableChatMessages');
    const base = { speaker: ChatMessage.getSpeaker({ actor: this.actor }), whisper: getChatRecipients() };
    const sessaoId = foundry.utils.randomID();
    const feitos = [];

    const pendentes = this._montarTestes(sessaoId);
    const custoPm = globais.reduce((s, g) => s + g.custo, 0) * pendentes.length;
    const pmAntes = pmDoAtor(this.actor);
    // O diálogo bloqueia, mas Enter passa por cima do botão desativado.
    if (custoPm > pmAntes.valor + pmAntes.temp) {
      return ui.notifications.warn(`${this.actor.name} não tem PM suficiente para estes efeitos.`);
    }

    for (const t of pendentes) {
      // Com a janela aberta, o chat diz de qual item é este teste.
      const aviso = comJanela && chat
        ? await ChatMessage.create({ ...base, content: cartaoDoTeste(this.actor.name, t, { pendente: true }) })
        : null;
      if (comJanela && !chat) ui.notifications.info(`Teste ${t.n} de ${t.de}: ${t.nome}`);

      const naFicha = !!this.actor.system?.pericias?.[t.chave];
      // v13 sem janela: o sistema não aplica efeitos de uso, a conta fica com t.mod.
      const peloEfeito = naFicha && (comJanela || ehV14());
      const efeitos = peloEfeito && t.penalidades.length
        ? await this.actor.createEmbeddedDocuments('ActiveEffect', t.penalidades.map(p => efeitoDaPenalidade(p, t.pericia)), { render: false })
        : [];
      let rolagem;
      try {
        rolagem = await this._rolarTeste(t.chave, comJanela);
      } finally {
        if (efeitos.length) await this.actor.deleteEmbeddedDocuments('ActiveEffect', efeitos.map(e => e.id), { render: false });
      }
      await aviso?.delete();

      if (!rolagem) {
        await this._encerrarMensagens(feitos, 'cancelado');
        // Na janela de uso, o sistema já cobrou o PM dos testes anteriores.
        await this._devolverPm(this._pmGasto(pmAntes));
        return ui.notifications.info('Testes cancelados. Nada foi gasto.');
      }

      // Na ficha, a penalidade já entrou na fórmula pelo efeito de uso.
      t.mod = (peloEfeito ? 0 : t.mod) + bonusGlobal;
      t.total = rolagem.total + t.mod;
      t.formula = `${rolagem.formula} = ${rolagem.total}`;
      t.passou = t.total >= t.cd;
      t.trocado = false;
      if (chat) {
        const mensagem = await ChatMessage.create({
          ...base,
          content: cartaoDoTeste(this.actor.name, t, { ativo: true }),
          rolls: [rolagem],
          flags: { [MODULE_ID]: { [FLAG_TESTE]: t } },
        });
        t.mensagemId = mensagem.id;
      }
      feitos.push(t);
    }

    if (custoPm > 0) {
      await this.actor.spendMana(custoPm, 0, false);
      ui.notifications.info(`${globais.map(g => g.nome).join(', ')}: ${custoPm} PM gastos.`);
    }

    this._sessao = { id: sessaoId, testes: feitos };
    // O sistema não espera o próprio gasto de PM: esta gravação vem depois dele.
    await this._gravarSessao();
    const pm = this._pmGasto(pmAntes);
    if (pm.valor || pm.temp) {
      this._sessao.pm = pm;
      await this._gravarSessao();
    }
  }

  /** O que saiu da ficha desde `antes`. */
  _pmGasto(antes) {
    const agora = pmDoAtor(this.actor);
    return { valor: Math.max(0, antes.valor - agora.valor), temp: Math.max(0, antes.temp - agora.temp) };
  }

  async _devolverPm({ valor = 0, temp = 0 } = {}) {
    if (!valor && !temp) return;
    const atual = pmDoAtor(this.actor);
    await this.actor.update({
      'system.attributes.pm.value': Math.min(atual.valor + valor, Number(this.actor.system.attributes.pm.max) || 0),
      'system.attributes.pm.temp': atual.temp + temp,
    });
    ui.notifications.info(`${valor + temp} PM devolvidos a ${this.actor.name}.`);
  }

  /** Tira os botões de todas as mensagens numa escrita só. */
  async _encerrarMensagens(testes, situacao = '') {
    const updates = testes
      .filter(t => game.messages.has(t.mensagemId))
      .map(t => {
        const atual = game.messages.get(t.mensagemId).getFlag(MODULE_ID, FLAG_TESTE) ?? t;
        return { _id: t.mensagemId, content: cartaoDoTeste(this.actor.name, atual, { situacao }) };
      });
    if (updates.length) await ChatMessage.updateDocuments(updates);
  }

  async _trocarResultado(id) {
    const t = this._sessao?.testes.find(x => x.id === id);
    if (!t) return;
    const mensagem = game.messages.get(t.mensagemId);
    if (mensagem) return trocarNaMensagem(mensagem);
    this.receberTroca({ id, passou: !t.passou, trocado: !t.trocado });
  }

  async _descartarSessao() {
    if (!this._sessao) return;
    const { testes, pm } = this._sessao;
    await this._encerrarMensagens(testes, 'descartado');
    this._sessao = null;
    await this._gravarSessao();
    await this._devolverPm(pm);
    this.render();
  }

  /** Quanto cada linha rende com os resultados atuais. */
  _apurarLinha(linha, testes) {
    const conta = calcularLinha(linha, this._prefs);
    let prontas = 0;
    let gastas = 0;
    let falhas = 0;
    conta.lotes.forEach((unidades, i) => {
      const passou = testes[i]?.passou ?? true;
      if (passou) prontas += unidades;
      else falhas += 1;
      if (passou || this._prefs.falhaGastaMaterial) gastas += unidades;
    });
    return {
      linha,
      testes,
      prontas,
      total: conta.unidades,
      faltam: falhas,
      custoCobre: gastas > 0 ? Math.max(0, conta.unitarioCobre * gastas - conta.descontoCobre) : 0,
      tempoHoras: conta.tempoHoras,
    };
  }

  /** Cobra, entrega e publica o relatório. `testes` vazio: nada foi rolado. */
  async _finalizar(testes) {
    const resultados = this._linhas.map(l => this._apurarLinha(l, testes.filter(t => t.linhaId === l.id)));
    const custo = resultados.reduce((soma, r) => soma + r.custoCobre, 0);
    const wealth = this.shopApp._wealthInfo();
    if (toCobre(wealth.to, wealth.tp, wealth.tc) < custo) {
      if (this.rendered) this.render();
      return ui.notifications.warn(`${this.actor.name} não tem moedas suficientes para esta lista.`);
    }
    for (const r of resultados) if (r.prontas > 0) await this._entregar(r.linha, r.prontas);
    await this._encerrarMensagens(testes);
    this._sessao = null;
    await this._gravarSessao();
    await this._fecharConta(resultados, wealth);
  }

  /** Empilha no que o ator já tem, com o mesmo critério da compra. */
  async _entregar(linha, unidades) {
    if (linha.tipo === 'aprimorar') {
      const alvo = { ...linha.aprimorar.alvo, qtdSeparar: unidades };
      return aplicarAprimoramento(this.actor, alvo, linha.aprimorar.calc);
    }

    if (linha.tipo === 'magia') {
      const { dedupeKey, itemData } = linha.magia;
      const existente = this.actor.items.find(i => i.getFlag(MODULE_ID, 'spellDedupeKey') === dedupeKey);
      if (existente && existente.system?.qtd !== undefined) {
        return existente.update({ 'system.qtd': (existente.system.qtd ?? 0) + unidades });
      }
      const dados = foundry.utils.deepClone(itemData);
      dados.system.qtd = unidades;
      const [criado] = await this.actor.createEmbeddedDocuments('Item', [dados]);
      if (criado) {
        await criado.setFlag(MODULE_ID, 'sourceUuid', linha.uuid);
        await criado.setFlag(MODULE_ID, 'spellDedupeKey', dedupeKey);
      }
      return criado;
    }

    const doc = await fromUuid(linha.uuid);
    const quantidade = unidades * linha.pacote;
    const existente = this.actor.items.find(i => {
      if (i.getFlag(MODULE_ID, 'aprimoramentos')) return false; // item aprimorado não empilha
      return i.getFlag(MODULE_ID, 'sourceUuid') === linha.uuid || i.name === doc.name;
    });
    if (existente && existente.system?.qtd !== undefined) {
      return existente.update({ 'system.qtd': (existente.system.qtd ?? 0) + quantidade });
    }
    const dados = doc.toObject();
    dados.system.qtd = quantidade;
    const [criado] = await this.actor.createEmbeddedDocuments('Item', [dados]);
    if (criado) await criado.setFlag(MODULE_ID, 'sourceUuid', linha.uuid);
    return criado;
  }

  async _fecharConta(resultados, wealth) {
    const prefs = this._prefs;
    const custoCobre = resultados.reduce((soma, r) => soma + r.custoCobre, 0);
    const tempoHoras = resultados.reduce((soma, r) => soma + r.tempoHoras, 0);
    const { to, tp, tc, troco, pago } = debitarCarteira(wealth, custoCobre);

    await this.actor.update({
      'system.dinheiro.to': to,
      'system.dinheiro.tp': tp,
      'system.dinheiro.tc': tc,
    }, { t20lojaInterno: true });

    // A lista recomeça vazia; o que falhou fica registrado no relatório.
    this._linhas = [];
    await this._gravarPlano();

    await this._publicarCartao(resultados, { custoCobre, tempoHoras, saldo: { to, tp, tc, tl: wealth.tl }, troco, pago });

    const prontas = resultados.reduce((soma, r) => soma + r.prontas, 0);
    const faltam = resultados.reduce((soma, r) => soma + Math.max(0, r.faltam), 0);
    ui.notifications.info(faltam
      ? `Construção concluída: ${prontas} pronto(s), ${faltam} craft(s) com falha.`
      : `Construção concluída: ${prontas} pronto(s).`);

    this.shopApp.render();
    this.render();
  }

  _linhaDoCartao({ linha, testes, prontas, total, custoCobre }) {
    const oficio = this.actor.system?.pericias?.[linha.oficio]?.label ?? 'Ofício: Escriba';
    const qtd = linha.tipo === 'aprimorar' ? '' : ` <em>×${prontas}/${total}</em>`;
    const resultados = testes.map(t => `<span class="t20l-cons-res ${t.passou ? 't20l-cons-ok' : 't20l-cons-falha'}">${t.total}</span>`).join('');
    const teste = testes.length
      ? `<span>${esc(oficio)} · CD ${linha.cd}</span>${resultados}`
      : `<span>${esc(oficio)} · sem rolagem</span>`;
    return `
      <div class="t20l-cons">
        <div class="t20l-item t20l-compacto"><img src="${linha.img}" alt="" />${esc(linha.nome)}${qtd}<b>${formatarCusto(custoCobre)}</b></div>
        <div class="t20l-cons-teste">${teste}</div>
      </div>`;
  }

  async _publicarCartao(resultados, { custoCobre, tempoHoras, saldo, troco, pago }) {
    // As rolagens já estão nas mensagens de cada teste.
    if (!game.settings.get(MODULE_ID, 'enableChatMessages')) return;
    const content = cartaoLoja({
      icone: 'fa-hammer',
      titulo: 'concluiu uma construção',
      ator: this.actor.name,
      corpo: `
        ${resultados.map(r => this._linhaDoCartao(r)).join('')}
        ${linhaCartao('Tempo gasto', `<b>${formatarTempo(tempoHoras, this._prefs)}</b>`)}
        ${linhaCartao('Total pago', `<b>${formatarCusto(custoCobre)}</b>`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo,
      mostrarTl: atorUsaPlatina(this.actor),
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      whisper: getChatRecipients(),
    });
  }
}
