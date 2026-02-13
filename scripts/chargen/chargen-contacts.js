// systems/cops/scripts/chargen/chargen-contacts.js

/**
 * Règle globale : maximum 2 contacts au niveau 4.
 */
const MAX_LEVEL4_CONTACTS = 2;

function _getActorContacts(actor) {
  return actor.items.filter(i => i.type === "contact");
}

function countLevel4(actor) {
  return _getActorContacts(actor).filter(c => Number(c.system?.niveau ?? 1) >= 4).length;
}

function canSetToLevel4(actor, contactIdBeingUpgraded = null) {
  const contacts = _getActorContacts(actor);
  let level4Count = 0;

  for (const c of contacts) {
    const lvl = Number(c.system?.niveau ?? 1);
    if (lvl >= 4) level4Count++;
  }

  // Si on upgrade un contact qui est déjà niveau 4, pas de souci.
  if (contactIdBeingUpgraded) {
    const c = actor.items.get(contactIdBeingUpgraded);
    if (c && Number(c.system?.niveau ?? 1) >= 4) return true;
  }

  return level4Count < MAX_LEVEL4_CONTACTS;
}

function normalizeContactType(type) {
  const t = String(type ?? "").toLowerCase().trim();
  if (t === "allie" || t === "allié") return "allie";
  if (t === "informateur" || t === "indic" || t === "indicateur") return "informateur";
  return null;
}

/**
 * Crée un contact embedded sur l'acteur.
 * @param {Actor} actor
 * @param {object} data
 * @param {string} data.name - Nom du contact (obligatoire)
 * @param {string} data.type - "allie" ou "informateur"
 * @param {string} data.domaine - Milieu (texte libre)
 * @param {number} data.niveau - 1..4 (origine sociale = 2)
 */
export async function createContact(actor, { name, type, domaine, niveau }) {
  if (!actor) throw new Error("createContact: actor manquant");
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null; // pas de contact -> pas d'erreur, juste rien

  const cleanType = normalizeContactType(type) ?? "allie";
  const lvl = Number(niveau ?? 1);

  if (lvl < 1 || lvl > 4) throw new Error(`Niveau contact invalide: ${lvl}`);

  // règle max 2 contacts niveau 4
  if (lvl === 4 && !canSetToLevel4(actor, null)) {
    ui.notifications.warn("Limite atteinte : maximum 2 contacts au niveau 4.");
    return null;
  }

  const docData = {
    name: cleanName,
    type: "contact",
    img: "systems/cops/icons/competences/Contact.png",
    system: {
      type: cleanType,
      domaine: String(domaine ?? "").trim(),
      niveau: lvl
    }
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [docData], { fromChargen: true });
  return created ?? null;
}

/**
 * Améliore +1 un contact, avec garde-fous.
 * @param {Actor} actor
 * @param {string} contactId
 * @param {number} delta - défaut +1
 */
export async function upgradeContact(actor, contactId, delta = 1) {
  if (!actor) throw new Error("upgradeContact: actor manquant");
  const contact = actor.items.get(contactId);
  if (!contact || contact.type !== "contact") return false;

  const cur = Number(contact.system?.niveau ?? 1);
  const next = cur + Number(delta);

  if (next > 4) {
    ui.notifications.warn("Un contact ne peut pas dépasser le niveau 4.");
    return false;
  }

  if (next === 4 && !canSetToLevel4(actor, contactId)) {
    ui.notifications.warn("Limite atteinte : maximum 2 contacts au niveau 4.");
    return false;
  }

  await contact.update({ "system.niveau": next });
  return true;
}

export function getContacts(actor) {
  return _getActorContacts(actor).map(c => ({
    id: c.id,
    name: c.name,
    type: c.system?.type,
    domaine: c.system?.domaine,
    niveau: Number(c.system?.niveau ?? 1)
  }));
}

/**
 * Crée un contact si absent, sinon augmente son niveau.
 * Matching simple: même nom (insensible à la casse).
 * @param {Actor} actor
 * @param {object} data {name,type,domaine,niveau}
 * @param {number} boost si contact existant -> +boost (ex: +1)
 */
export async function createOrBoostContact(actor, { name, type, domaine, niveau }, boost = 1) {
  if (!actor) throw new Error("createOrBoostContact: actor manquant");

  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;

  const existing = actor.items.find(i =>
    i.type === "contact" &&
    i.name?.localeCompare(cleanName, undefined, { sensitivity: "base" }) === 0
  );

  if (!existing) {
    // Création normale
    return await createContact(actor, { name: cleanName, type, domaine, niveau });
  }

  // Si déjà là -> boost (par défaut +1)
  await upgradeContact(actor, existing.id, boost);
  return existing;
}


export function rules() {
  return { MAX_LEVEL4_CONTACTS };
}
