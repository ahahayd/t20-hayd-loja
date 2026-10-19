/**
 * Versão do Foundry em que a loja está rodando.
 *
 * O módulo roda no v13 (Tormenta20 1.5) e no v14 (Tormenta20 1.6) com o
 * mesmo código. Onde os dois diferem, o código pergunta `ehV14()` e segue
 * o caminho de cada um. Cada versão do Tormenta20 só existe numa versão do
 * Foundry, então isto também separa o formato de dados do sistema.
 */
export function ehV14() {
  return (game.release?.generation ?? 13) >= 14;
}
