/* ════════════════════════════════════════════════════════════════
   t20-hayd-loja — AGITAÇÃO DA LAMPARINA

   Quem balança a lamparina é o CSS (@keyframes loja-lamp-sway). Este
   módulo não anima nada: ele só engorda a AMPLITUDE do balanço quando
   a janela se mexe, escrevendo --lamp-amp / --lamp-amp2, e deixa ela
   murchar de volta ao repouso.

   Aqui houve antes um pêndulo duplo simulado de verdade, com a
   aceleração da janela entrando nas equações. Funcionava, mas não ficou
   bom de olhar: física correta num objeto deste tamanho dá movimento
   miúdo e sem graça, e para girar exigia bombear na ressonância, o que
   ninguém vai descobrir sem querer. Amplitude modulada entrega o que se
   espera de um lampião de loja e cabe em trinta linhas.

   Duas consequências boas de não integrar nada:

     · não há estado que possa divergir — sem NaN, sem capotamento, sem
       os 360° ao abrir a janela;
     · a estimativa usa só a PRIMEIRA derivada da posição. A versão com
       física precisava da segunda, e derivar duas vezes um sinal
       quantizado em pixel inteiro media picos absurdos com a janela
       parada — era a origem da vibração.

   O balanço em si continua sendo do compositor: o JS escreve uma custom
   property de vez em quando e some. Em repouso ele não escreve nada.
   ════════════════════════════════════════════════════════════════ */

/* Amplitudes em grau. BASE é o repouso (o mesmo balanço de sempre) e
   PICO é o arrasto mais violento. O corpo da lamparina usa valores
   menores que a corrente: ele pendura na ponta dela e se inclina menos. */
const BASE      = 2.0;
const PICO      = 13.0;
const BASE_CORPO = 1.2;
const PICO_CORPO = 6.5;

const VEL_CHEIA = 1200;  // px/s que já valem amplitude máxima
const SUAVIZA   = 0.30;  // média exponencial na velocidade
const DECAI     = 2.2;   // segundos para a agitação murchar
const SALTO_MAX = 120;   // px num frame: é teletransporte, não arrasto
const AQUECE    = 5;     // frames descartados (a janela ainda vai ser posicionada)
const DT_MAX    = 1 / 30;
const PASSO_MIN = 0.04;  // grau — abaixo disto não vale reescrever o estilo

/**
 * Faz a lamparina de `raiz` reagir ao movimento de `janela`.
 * @param {HTMLElement} janela  O elemento .app da janela (quem se move).
 * @param {HTMLElement} raiz    O elemento que contém a .loja-lamp.
 * @returns {{destroy: () => void}|null}
 */
export function agitarLamparina(janela, raiz) {
  const lamp  = raiz?.querySelector('.loja-lamp');
  const corpo = lamp?.querySelector('.loja-lamp__body');
  if (!janela || !lamp || !corpo) return null;

  // Quem pediu menos movimento não ganha agitação. O CSS já desligou o
  // keyframes; aqui a gente só não encosta em nada.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;

  let x = janela.offsetLeft, y = janela.offsetTop;
  let vel = 0;        // px/s, filtrada
  let energia = 0;    // 0 = parada, 1 = arrasto máximo
  let escrito = -1;   // última amplitude escrita, para não reescrever à toa
  let aquece = AQUECE;
  let ultimo = performance.now();
  let rafId = null;
  let vivo = true;

  function passo(agora) {
    if (!vivo) return;
    rafId = requestAnimationFrame(passo);

    // Teto no dt: trocar de aba congela o rAF, e o primeiro frame na
    // volta chega com vários segundos acumulados.
    const dt = Math.min((agora - ultimo) / 1000, DT_MAX);
    ultimo = agora;
    if (dt <= 0) return;

    // LEITURA primeiro, ESCRITA depois: offsetLeft força cálculo de
    // layout, e intercalar os dois no mesmo frame vira layout thrashing.
    const nx = janela.offsetLeft;
    const ny = janela.offsetTop;
    const dx = nx - x, dy = ny - y;
    x = nx; y = ny;

    if (aquece > 0) {
      // Ao abrir, o Foundry posiciona a janela DEPOIS do render. Sem
      // isto, esse salto inicial seria lido como o arrasto do século.
      aquece--;
      vel = 0;
    } else if (Math.abs(dx) > SALTO_MAX || Math.abs(dy) > SALTO_MAX) {
      // Snap, maximizar, setPosition: a janela mudou de lugar sem
      // ninguém ter sacudido nada.
      vel = 0;
    } else {
      vel += (Math.hypot(dx, dy) / dt - vel) * SUAVIZA;
    }

    // Sobe na hora, desce devagar: é o que dá a sensação de impulso.
    // Se a subida também fosse suave, a lamparina reagiria depois que o
    // jogador já soltou a janela.
    const alvo = Math.min(1, vel / VEL_CHEIA);
    energia = alvo > energia ? alvo : Math.max(0, energia - energia * dt / DECAI * 3);

    const amp = BASE + energia * (PICO - BASE);
    if (Math.abs(amp - escrito) < PASSO_MIN) return;   // em repouso, não escreve nada
    escrito = amp;

    lamp.style.setProperty('--lamp-amp', `${amp.toFixed(2)}deg`);
    corpo.style.setProperty(
      '--lamp-amp2',
      `${(BASE_CORPO + energia * (PICO_CORPO - BASE_CORPO)).toFixed(2)}deg`
    );
  }

  rafId = requestAnimationFrame(passo);

  return {
    destroy() {
      vivo = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lamp.style.removeProperty('--lamp-amp');
      corpo.style.removeProperty('--lamp-amp2');
    }
  };
}
