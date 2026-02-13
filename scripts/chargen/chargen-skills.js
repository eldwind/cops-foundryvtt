// systems/cops/scripts/chargen/chargen-skills.js
console.log("COPS | chargen skills loaded");

/**
 * Helpers: accès compendium "cops.competences"
 */
async function _getSkillsPack() {
  return game.packs.get("cops.competences") ?? null;
}

async function _getPackIndex(pack) {
  if (!pack) return [];
  await pack.getIndex();
  return pack.index ?? [];
}

function _normName(s) {
  return String(s ?? "").trim().toLowerCase();
}

function _findActorSkill(actor, name) {
  const n = _normName(name);
  return actor.items.find(i => i.type === "skill" && _normName(i.name) === n) ?? null;
}

/**
 * Lit config spé depuis le compendium, sinon fallback.
 * Retour:
 *  { specialisationAt, specialisationMode, specialisationOptions }
 */
export async function getSkillConfig(skillName) {
  const pack = await _getSkillsPack();
  const idx = await _getPackIndex(pack);

  const entry = idx.find(e => _normName(e.name) === _normName(skillName));
  if (!entry) {
    return { specialisationAt: 0, specialisationMode: "fixed", specialisationOptions: [] };
  }

  const doc = await pack.getDocument(entry._id);
  const sys = doc?.system ?? {};

  return {
    specialisationAt: Number(sys.specialisationAt ?? 0),
    specialisationMode: String(sys.specialisationMode ?? "fixed"),
    specialisationOptions: Array.isArray(sys.specialisationOptions) ? sys.specialisationOptions : []
  };
}

/**
 * Pour debug/inspection
 */
export function describeSkill(skillItem) {
  const sys = skillItem?.system ?? {};
  return {
    name: skillItem?.name,
    niveau: sys.niveau,
    specialisationAt: sys.specialisationAt,
    specialisationMode: sys.specialisationMode,
    options: sys.specialisationOptions ?? [],
    specialisations: sys.specialisations ?? {}
  };
}

/**
 * Crée / met à jour une compétence pour la création (chargen).
 *
 * Règles (alignées avec ton système):
 * - Type créé = "skill"
 * - Niveau minimal = 2 (sécurité)
 * - Si spécialisationAt = 9 (cas 9+): pas de "Général" jouable,
 *   on garde base à 10 et on crée la spé au niveau demandé.
 * - Si palier (ex: 8): si on met la spé à 8, la base reste bloquée à 9.
 * - Jamais d'XP dépensée si createOptions.fromChargen === true
 */
export async function setSkillCreationLevel(actor, skillName, level, { specKey = null, createOptions = {} } = {}) {
  if (!actor) return;

  const fromChargen = !!createOptions?.fromChargen;

  // clamp de sécurité
  // En chargen (wizard), une compétence (général ou spé) ne doit jamais descendre sous 5.
  const minLevel = fromChargen ? 5 : 2;
  let targetLevel = Math.max(minLevel, Number(level ?? 10));

  // Lire config
  const cfg = await getSkillConfig(skillName);
  const specAt = Number(cfg.specialisationAt ?? 0);

  // Récup item actor (type skill)
  let it = _findActorSkill(actor, skillName);

  // Si pas trouvé: créer depuis compendium si possible, sinon minimal.
  if (!it) {
    const pack = await _getSkillsPack();
    const idx = await _getPackIndex(pack);
    const entry = idx.find(e => _normName(e.name) === _normName(skillName));

    let itemData;
    if (entry) {
      const doc = await pack.getDocument(entry._id);
      itemData = doc.toObject();
      itemData.type = "skill"; // CANONIQUE
    } else {
      itemData = {
        name: skillName,
        type: "skill",
        img: "icons/svg/item-bag.svg",
        system: {
          niveau: 10,
          caracteristique: "reflexes",
          specialisationAt: cfg.specialisationAt ?? 0,
          specialisationMode: cfg.specialisationMode ?? "fixed",
          specialisationOptions: cfg.specialisationOptions ?? [],
          specialisations: {}
        }
      };
    }

    // Important: pas d'XP ici (chargen)
    const created = await actor.createEmbeddedDocuments("Item", [itemData], createOptions);
    it = created?.[0] ?? _findActorSkill(actor, skillName);
  }

  if (!it) return;

  const sys = it.system ?? {};
  const specs = foundry.utils.duplicate(sys.specialisations ?? {});
  const cleanSpec = String(specKey ?? "").trim();

  // --- Cas 9+ : spé obligatoire à l'acquisition, pas de général jouable
  if (specAt >= 9) {
    if (!cleanSpec) {
      // pas de spé fournie => on ne fait rien (le wizard doit imposer un choix)
      ui.notifications?.warn?.(`Spécialisation requise pour ${skillName} (9+).`);
      return;
    }

    // Base gardée à 10, la spé prend le niveau demandé (>=2)
    specs[cleanSpec] = targetLevel;

    await it.update({
      "system.niveau": 10,
      "system.specialisations": specs
    });

    if (!fromChargen) ui.notifications?.info?.(`Compétence apprise : ${skillName} (${cleanSpec}) N${targetLevel}.`);
    return;
  }

  // --- Cas palier (ex: 8)
  if (cleanSpec) {
    // On crée/maj la spé au niveau demandé
    specs[cleanSpec] = targetLevel;

    // Base bloquée à (palier+1) si on a atteint le palier
    const baseLevel = Number(sys.niveau ?? 10);
    const minBase = (specAt > 0) ? (specAt + 1) : 2;
    const newBase = Math.max(baseLevel, minBase);

    await it.update({
      "system.niveau": newBase,
      "system.specialisations": specs
    });

    if (!fromChargen) ui.notifications?.info?.(`Spécialisation ajoutée : ${skillName} (${cleanSpec}) N${targetLevel}.`);
    return;
  }

  // --- Cas sans spé: on fixe juste le général
  await it.update({ "system.niveau": targetLevel });
  if (!fromChargen) ui.notifications?.info?.(`Compétence ajustée : ${skillName} N${targetLevel}.`);
}
