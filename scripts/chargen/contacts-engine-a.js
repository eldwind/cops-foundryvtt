// systems/cops/scripts/chargen/contacts-engine-a.js
// Moteur A (Contacts) pour le wizard.
//
// Objectif UX:
// - Le champ "Nom" ne sert qu'à créer un nouveau contact.
// - Pour améliorer, on choisit un contact existant via une liste déroulante.
// - Si on tente de créer un contact dont le nom existe déjà => blocage + message clair.
// - Domaine conseillé (non bloquant).
//
// Pré-requis:
// - Le module canonique contacts est chargé : game.cops.chargen.contacts
//   (scripts/chargen/chargen-contacts.js)

console.log("COPS | chargen contacts-engine-a loaded");

/** Normalise un nom pour comparaison */
function _norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Récupère les contacts existants (items type "contact") sous forme d'options UI.
 * @returns {Array<{id:string,label:string,name:string,niveau:number,domaine:string,type:string}>}
 */
export function listActorContacts(actor) {
  if (!actor) return [];
  const items = actor.items?.filter?.(i => i.type === "contact") ?? [];
  return items
    .map(it => {
      const sys = it.system ?? {};
      const niveau = Number(sys.niveau ?? 1);
      const domaine = String(sys.domaine ?? "");
      const type = String(sys.type ?? "");
      const name = String(it.name ?? "");
      const label = `${name} (N${niveau}${domaine ? ` • ${domaine}` : ""})`;
      return { id: it.id, label, name, niveau, domaine, type };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/**
 * Vérifie si un nom existe déjà sur l'acteur (case-insensitive).
 */
export function contactNameExists(actor, name) {
  const n = _norm(name);
  if (!actor || !n) return false;
  return (actor.items?.some?.(it => it.type === "contact" && _norm(it.name) === n)) ?? false;
}

/**
 * Validation "create": nom obligatoire, et doit être unique.
 * @returns {null|string} null si OK, sinon message d'erreur
 */
export function validateCreateContact(actor, { name }) {
  const n = String(name ?? "").trim();
  if (!n) return "Nom de contact obligatoire.";
  if (contactNameExists(actor, n)) {
    return `Le contact "${n}" existe déjà : utilise la liste déroulante pour l'améliorer, ou choisis un autre nom.`;
  }
  return null;
}

/**
 * Validation "upgrade": un targetId doit être fourni.
 * @returns {null|string}
 */
export function validateUpgradeContact(actor, { targetId }) {
  if (!actor) return "Acteur introuvable.";
  if (!targetId) return "Choisis un contact à améliorer.";
  const it = actor.items?.get?.(targetId) ?? null;
  if (!it || it.type !== "contact") return "Contact sélectionné invalide.";
  return null;
}

/**
 * Applique un "slot" de contact.
 *
 * @param {Actor} actor
 * @param {object} choice
 * @param {number} boost
 * @param {object} [opts]
 * @param {boolean} [opts.strictMax4=true] - bloque si l'action ferait dépasser N4 ou enfreindre la limite 2xN4
 * @param {object} [opts.createOptions={fromChargen:true}]
 *
 * @returns {Promise<{ok:true}|{ok:false,message:string}>}
 */
export async function applyContactChoice(actor, choice, boost = 1, opts = {}) {
  const Contacts = game.cops?.chargen?.contacts;
  if (!Contacts) return { ok: false, message: "Chargen: module contacts non chargé." };
  if (!actor) return { ok: false, message: "Acteur introuvable." };

  const strictMax4 = opts.strictMax4 ?? true;
  const createOptions = opts.createOptions ?? { fromChargen: true };

  const mode = String(choice?.mode ?? "").toLowerCase();

  if (mode === "create") {
    const err = validateCreateContact(actor, choice);
    if (err) return { ok: false, message: err };

    const name = String(choice.name).trim();
    const domaine = String(choice.domaine ?? "").trim();
    const t = String(choice.type ?? "informateur").toLowerCase();
    const type = (t === "indic" || t === "informateur") ? "informateur" : "allie";

    // Ici, boost = niveau initial (1 ou 2 selon le slot)
    const res = await Contacts.createOrBoostContact(
      actor,
      { name, type, domaine, niveau: boost },
      0,
      { ...createOptions, strictMax4 }
    );
    if (res?.ok === false) return res;
    return { ok: true };
  }

  if (mode === "upgrade") {
    const err = validateUpgradeContact(actor, choice);
    if (err) return { ok: false, message: err };

    const it = actor.items.get(choice.targetId);
    const sys = it.system ?? {};
    const name = String(it.name ?? "");
    const domaine = String(sys.domaine ?? "");
    const type = String(sys.type ?? "informateur");

    // Ici, boost = +1 (toujours, sauf si tu passes autre chose)
    const res = await Contacts.createOrBoostContact(
      actor,
      { name, type, domaine, niveau: boost },
      0,
      { ...createOptions, strictMax4 }
    );
    if (res?.ok === false) return res;
    return { ok: true };
  }

  return { ok: false, message: "Mode de contact invalide (create|upgrade)." };
}

/**
 * Applique les 2 points finaux "libres" dédiés aux contacts.
 * allocations = tableau de 2 entrées, chacune étant un choice {mode,...}
 */
export async function applyFinalFreeContactPoints(actor, allocations = [], opts = {}) {
  const list = Array.isArray(allocations) ? allocations : [];
  const createOptions = opts.createOptions ?? { fromChargen: true };

  // On exécute 2 fois, +1 à chaque fois.
  for (let i = 0; i < Math.min(2, list.length); i++) {
    const choice = list[i];
    if (!choice) continue;
    const res = await applyContactChoice(actor, choice, 1, { ...opts, createOptions });
    if (!res.ok) return res;
  }
  return { ok: true };
}
