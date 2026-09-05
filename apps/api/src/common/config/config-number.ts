import { Logger } from '@nestjs/common';

/**
 * Lit un **nombre** de configuration, là où `process.env` ne rend que du
 * texte. Adaptation (pas import — les deux dépôts restent indépendants, §6.3)
 * de `configNumber()` d'`echangopromo`.
 *
 * ── Pourquoi ce garde-fou ────────────────────────────────────────────────
 *
 * Une valeur illisible (`'abc'`, `''`), d'un type inattendu, ou hors des
 * bornes retombe sur `defaut` **en le journalisant**. Refuser au démarrage
 * rendrait une faute de frappe dans `.env` capable d'empêcher le service de
 * servir ; le repli est donc assumé, mais l'information d'absence n'est pas
 * détruite — elle est déplacée dans le journal. C'est ce qui distingue ce
 * repli d'un défaut silencieux.
 *
 * Ici toutes les clés numériques sont des débits ou des délais : zéro et
 * négatif n'y ont aucun sens et sont refusés.
 */
const logger = new Logger('configNumber');

/** Replis déjà signalés, pour ne le dire qu'une fois par clé. */
const dejaSignale = new Set<string>();

function signaler(cle: string, message: string): void {
  const empreinte = `${cle}|${message}`;
  if (dejaSignale.has(empreinte)) return;
  dejaSignale.add(empreinte);
  logger.warn(message);
}

/** Réservé aux tests — la mémoire des replis signalés est un état de module. */
export function _resetConfigNumberLog(): void {
  dejaSignale.clear();
}

export function configNumber(
  brut: unknown,
  defaut: number,
  cle: string,
  options?: { minimum?: number; maximum?: number },
): number {
  if (
    brut === undefined ||
    brut === null ||
    (typeof brut === 'string' && brut.trim() === '')
  ) {
    signaler(cle, `${cle} absente de la configuration — valeur retenue : ${defaut}`);
    return defaut;
  }

  // N'accepter QUE `number` et `string` : `Number(true)` vaut 1, `Number([5])`
  // vaut 5 — passer par `Number()` sans filtrer le type convertirait des
  // choses qui n'étaient pas des nombres au lieu de les refuser.
  if (typeof brut !== 'number' && typeof brut !== 'string') {
    signaler(
      cle,
      `${cle} de configuration d'un type inattendu (${typeof brut}) — repli sur ${defaut}`,
    );
    return defaut;
  }

  const n = Number(brut);

  if (!Number.isFinite(n)) {
    signaler(
      cle,
      `${cle} de configuration illisible (${String(brut)}) — repli sur ${defaut}`,
    );
    return defaut;
  }

  if (n <= 0) {
    signaler(
      cle,
      `${cle} de configuration nulle ou négative (${n}) — repli sur ${defaut}`,
    );
    return defaut;
  }

  if (options?.minimum !== undefined && n < options.minimum) {
    signaler(
      cle,
      `${cle} de configuration sous le minimum autorisé (${n} < ${options.minimum}) — repli sur ${defaut}`,
    );
    return defaut;
  }

  if (options?.maximum !== undefined && n > options.maximum) {
    signaler(
      cle,
      `${cle} de configuration au-dessus du maximum autorisé (${n} > ${options.maximum}) — repli sur ${defaut}`,
    );
    return defaut;
  }

  return n;
}
