/**
 * Marca as janelas DESTE módulo com `hayd-ui`, a classe de onde pendem os
 * tokens e as primitivas de `styles/hayd-ui-base.css`.
 *
 * O critério é "a janela é nossa", e não "tem markup nosso dentro".
 *
 * A diferença importa: um módulo que injeta um botão na ficha do sistema, ou
 * uma seção na tela de configurações do Foundry, deixa markup dele dentro de
 * uma janela que é DOS OUTROS. Marcar por conteúdo acabava aplicando a base
 * visual na barra lateral, no chat, no diretório de atores e na tela de
 * configurações do core — que não são nossas para redesenhar.
 *
 * Aqui a lista é curta de propósito: a janela da Loja e o carrinho NÃO
 * entram — o visual deles é o que é e está do jeito que o autor quer.
 *
 * Então: só um diálogo criado por nós (os diálogos do core nunca têm markup
 * com os prefixos deste módulo) ou uma das janelas da lista explícita.
 *
 * A raiz sai de `app.element`: há fichas que chegam ao hook com o elemento de
 * uma PARTE (já vi um <button> de cabeçalho), e marcar a parte não leva os
 * tokens a lugar nenhum. Em janela v1 esse `element` é um jQuery, daí o
 * desembrulho.
 */

const CLASSE = 'hayd-ui';
const MARCADOR = '[class*="t20-loja-qty"], [class*="t20-loja-spell"], [class*="t20-loja-craft"], [class*="t20-loja-tema"], [class*="apr-"]';
/** Janelas próprias do módulo, pelo nome da classe da aplicação. */
const JANELAS_PROPRIAS = new Set(['AprimorarApplication']);

function ehDialogo(app) {
  const V2 = foundry.applications?.api?.DialogV2;
  if (V2 && app instanceof V2) return true;
  // Janelas v1: Dialog clássico.
  return typeof Dialog !== 'undefined' && app instanceof Dialog;
}

function ehNossa(app, raiz) {
  if (JANELAS_PROPRIAS.has(app?.constructor?.name)) return true;
  return ehDialogo(app) && (raiz.matches(MARCADOR) || !!raiz.querySelector(MARCADOR));
}

function marcar(app, elemento) {
  const bruto = app?.element ?? elemento;
  // Desembrulha jQuery, mas NUNCA indexa um elemento: a raiz destas janelas
  // costuma ser um <form>, e `form[0]` devolve o primeiro CAMPO do
  // formulário — marcava o checkbox em vez da janela.
  const raiz = bruto instanceof HTMLElement ? bruto : (bruto?.[0] ?? bruto);
  if (!(raiz instanceof HTMLElement) || raiz.classList.contains(CLASSE)) return;
  if (!ehNossa(app, raiz)) return;
  raiz.classList.add(CLASSE);
  // A vitrine da Loja tem tema próprio (e pode estar clara); estas janelas
  // utilitárias seguem o padrão escuro da família, que é o que a pessoa já
  // conhece das outras janelas dos módulos.
  raiz.classList.add('hayd-ui-escuro');
}

Hooks.on('renderApplicationV2', marcar);
Hooks.on('renderDialogV2', marcar);
// Janelas v1 (Application/Dialog) ainda existem em módulos mais antigos.
Hooks.on('renderApplication', marcar);
Hooks.on('renderDialog', marcar);
