import { rollCops } from "./dice.js";
const { DialogV2 } = foundry.applications.api;

export class CopsItem extends Item {

    // --- NOUVEAU : GESTION DU COÛT À LA CRÉATION (DROP & BOUTON) ---
    async _preCreate(data, options, userId) {
        await super._preCreate(data, options, userId);

        const actor = this.parent;

        if ((this.type === "competence" || this.type === "skill") && actor && !options.fromStarterKit && !options.fromChargen && !options.fromImport) {
             const currentXP = actor.system.ressources.xp;
             if (currentXP < 5) {
                 ui.notifications.warn("XP Insuffisant : Il faut 5 XP pour apprendre une nouvelle compétence.");
                 return false; 
             }
             this.updateSource({ "system.niveau": 9 });
        }
    }

    // --- MODIFICATION 2 : PAIEMENT APRÈS CRÉATION (DÉBIT XP) ---
    async _onCreate(data, options, userId) {
        await super._onCreate(data, options, userId);
        if (userId !== game.user.id) return;

        const actor = this.parent;

        if ((this.type === "competence" || this.type === "skill") && actor && !options.fromStarterKit && !options.fromChargen && !options.fromImport) {
            const currentXP = actor.system.ressources.xp;
            await actor.update({ "system.ressources.xp": currentXP - 5 });
            ui.notifications.info(`Compétence apprise : ${this.name} (Niveau 9). 5 XP dépensés.`);
        }
    }

    async roll() {
        if (!this.actor) return;
        if (this.type === "arme" || this.type === "weapon") await this.rollWeapon();
        else if (this.type === "competence" || this.type === "skill") await this.rollSkill();
        else this.sheet.render(true);
    }

    /* --- GESTION RAFALE --- */
    async rollBurst() {
        const actor = this.actor;
        const sys = this.system;
        const useWeaponSkillForBurst = sys.useWeaponSkillForBurst === true;
        
        const vrcCost = sys.rafaleCourte || 3;
        const currentAmmo = sys.munitions.value;
        if (sys.munitions.max > 0 && currentAmmo < vrcCost) {
            ui.notifications.warn(`Pas assez de munitions pour une rafale ! (Requis: ${vrcCost})`);
            return;
        }
        
        // --- Choix de la compétence utilisée pour la rafale ---

            const rafaleSkillName = useWeaponSkillForBurst
            ? (sys.competence && sys.competence.trim() !== "" ? sys.competence : "Tir en rafales")
            : "Tir en rafales";

            let rafSpec = useWeaponSkillForBurst
            ? (sys.competenceSpec ?? "base")
            : (sys.rafaleSpec ?? "base");

            const skillItem = this._findActorSkill(actor, rafaleSkillName);


                try {
                const norm = (s) => String(s ?? "").trim().toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                const pack = game.packs.get("cops.competences");
                if (pack) {
                    await pack.getIndex();
                    const entry = pack.index.find(e => norm(e.name) === norm(rafaleSkillName));
                    if (entry) {
                    const doc = await pack.getDocument(entry._id);
                    const at = Number(doc?.system?.specialisationAt ?? 0);
                    const opts = Array.isArray(doc?.system?.specialisationOptions)
                        ? doc.system.specialisationOptions
                        : [];

                    if (at === 9) {
                        // 9+ : pas de "base"
                        if (!opts.includes(rafSpec)) {
                        rafSpec = opts[0] ?? "";
                        await this.update({ "system.rafaleSpec": rafSpec });
                        }
                    } else if (at > 0) {
                        // normal : "base" autorisé
                        const allowed = new Set(["base", ...opts]);
                        if (!allowed.has(rafSpec)) {
                        rafSpec = "base";
                        await this.update({ "system.rafaleSpec": rafSpec });
                        }
                    } else {
                        // pas de spé
                        if (rafSpec !== "base") {
                        rafSpec = "base";
                        await this.update({ "system.rafaleSpec": rafSpec });
                        }
                    }
                    }
                }
                } catch (e) {
                console.warn("COPS | auto-fix rafaleSpec failed", e);
                }

                const skillLevel = this._getSkillSeuil(actor, rafaleSkillName, rafSpec);

        // ✅ dés : carac vient de l’arme
        const caracKey = (sys.caracteristique && String(sys.caracteristique).trim() !== "")
        ? sys.caracteristique
        : "coordination";

        const caracValue = actor.system.caracteristiques[caracKey].value;
        const hasBlue = (skillItem?.system?.hasBlue || actor.system.caracteristiques[caracKey].hasBlue || sys.hasBlue);
        const weaponPrecision = sys.precision || 0;

        const adrValue = actor.system.ressources.adrenaline.value;
        const canUseAdr = (adrValue > 0) && (this.system.allowAdrenaline !== false);

        const myAttitude = actor.system.combat?.attitude || "standard";
        let attPoolBonus = 0;
        if (myAttitude === "ultra") attPoolBonus = 2;
        else if (myAttitude === "agressif") attPoolBonus = 1;
        else if (myAttitude === "prudent") attPoolBonus = -1;
        else if (myAttitude === "planque") attPoolBonus = -2;

        const targets = game.user.targets;
        let targetActor = null;
        let targetDefMod = 0;
        let targetAttName = "Normal";

        if (targets.size > 0) {
            targetActor = targets.first().actor;
            const tAtt = targetActor.system.combat?.attitude || "standard";
            if (tAtt === "ultra") { targetDefMod = -2; targetAttName="Ultra (-2 Succès requis)"; }
            else if (tAtt === "agressif") { targetDefMod = -1; targetAttName="Agressif (-1 Succès requis)"; }
            else if (tAtt === "prudent") { targetDefMod = 1; targetAttName="Prudent (+1 Succès requis)"; }
            else if (tAtt === "planque") { targetDefMod = 2; targetAttName="Planqué (+2 Succès requis)"; }
        }

        const dialogContent = `
            <div style="text-align:center;">
                <h3 style="color:#00ccff;">TIR EN RAFALE</h3>
                <p><strong>${this.name}</strong> (VRC ${vrcCost})</p>
                <div style="display:flex; justify-content:space-between; align-items:center; margin:5px 0;">
                    <label>Difficulté (Seuil)</label>
                    <input type="number" id="seuil" value="${skillLevel}" style="width:50px; text-align:center;">
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <label>Modificateur</label>
                    <input type="number" id="mod" value="0" style="width:50px; text-align:center;">
                </div>
                ${(() => {
                    const lastRange = game.user.flags["cops"]?.lastRange ?? 2;
                    return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:5px;">
                    <label style="flex:1; min-width:0;">Portée du tir</label>
                    <select id="attackRange" style="flex:0 0 230px; min-width:230px; max-width:230px;">
                        <option value="1" ${lastRange === 1 ? "selected" : ""}>Courte (&lt; 10 m)</option>
                        <option value="2" ${lastRange === 2 ? "selected" : ""}>Moyenne (≤ portée arme)</option>
                        <option value="3" ${lastRange === 3 ? "selected" : ""}>Longue (≤ 2× portée arme)</option>
                    </select>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:5px;">
                    <label style="flex:1; min-width:0;">Modificateur MJ</label>
                    <input type="number" id="mjMod" value="0" style="flex:0 0 70px; width:70px; text-align:center;">
                </div>`;
                })()}

                ${canUseAdr ? `<div style="margin-top:5px; text-align:left; background:rgba(255,255,0,0.1); padding:5px; border-radius:4px;">
                    <label style="cursor:pointer; display:flex; align-items:center;">
                        <input type="checkbox" id="useAdr" style="margin-right:8px;"> 
                        ⚡ Dépenser 1 Adrénaline (+1D)
                    </label>
                </div>` : ""}
                <div style="font-size:0.8em; color:#aaa; margin-top:5px; border-top:1px solid #444; padding-top:2px;">
                    <div>Mon Attitude : <strong>${myAttitude.toUpperCase()}</strong> (${attPoolBonus >= 0 ? '+' : ''}${attPoolBonus}D)</div>
                    ${targetActor ? `<div>Cible : <strong>${targetAttName}</strong> (${targetDefMod >= 0 ? '+' : ''}${targetDefMod} Diff)</div>` : ""}
                </div>
            </div>
        `;

        await DialogV2.wait({
            window: { title: "Rafale", width: 560 },
            content: dialogContent,
            buttons: [{
                action: "fire", label: "ARROSER !", icon: "fas fa-fighter-jet", default: true,
                callback: async (event, button, dialog) => {
                    const baseSeuil = parseInt(dialog.element.querySelector("#seuil").value);
                    const poolMod = parseInt(dialog.element.querySelector("#mod").value);

                    // Conditions de tir (évite une 2ème fenêtre)
                    let attackRange = 2;
                    let mjMod = 0;
                    {
                        const rangeEl = dialog.element.querySelector("#attackRange");
                        const mjEl = dialog.element.querySelector("#mjMod");
                        if (rangeEl) attackRange = Number(rangeEl.value);
                        if (mjEl) mjMod = Number(mjEl.value);

                        await game.user.setFlag("cops", "lastRange", attackRange);
                    }

                    
                    let adrBonus = 0;
                    const adrCheckbox = dialog.element.querySelector("#useAdr");
                    if ((this.system.allowAdrenaline !== false) && adrCheckbox && adrCheckbox.checked) {
                        adrBonus = 1;
                        await actor.update({ "system.ressources.adrenaline.value": adrValue - 1 });
                        ui.notifications.info("1 Point d'Adrénaline dépensé !");
                    }

                    if (sys.munitions.max > 0) await this.update({ "system.munitions.value": currentAmmo - vrcCost });

                    const finalSeuil = baseSeuil;
                    const finalPool = Math.max(1, caracValue + weaponPrecision + poolMod + attPoolBonus + adrBonus);

                    await rollCops(finalPool, finalSeuil, `Rafale : ${this.name}`, {
                        actor: actor, target: targetToken,
                        blueDie: hasBlue, weapon: this,
                        isAttack: true, isBurst: true, vrc: vrcCost,
                        attackConditions: { range: attackRange, mod: mjMod },
                        type: "attaque", diff: finalSeuil,
                        // TAGS POUR BONUS STAGE
                        tags: ["tir", "combat", "rafale"]
                    });
                }
            }]
        });
    }

            _normKey(s) {
                return String(s ?? "")
                .trim()
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");
            }

             _findActorSkill(actor, skillName) {
                const wanted = this._normKey(skillName);

                // Alias UI -> nom compendium / nom réel des items compétence
                const ALIASES = {
                "armes lourdes": "arme lourde",
                "armes d'epaule": "arme d'epaule",       // si jamais tu as une variante sans accent
                "armes d’épaule": "arme d’épaule",
                "armes de contact": "arme de contact",
                };

                const wantedAliased = ALIASES[wanted] ?? wanted;

                return actor.items.find(i =>
                (i.type === "competence" || i.type === "skill") &&
                this._normKey(i.name) === wantedAliased
                );
            }


            _getSkillSeuil(actor, skillName, specKey) {
                const skill = this._findActorSkill(actor, skillName);
                if (!skill) return 10;

                const specs = skill.system.specialisations ?? {};
                const specAt = Number(skill.system.specialisationAt ?? 0);
                const hasBaseLine = specAt !== 9;

                const wanted = String(specKey ?? "base").trim();
                if (wanted && wanted !== "base") {
                if (typeof specs[wanted] === "number") return Number(specs[wanted]);

                const w = this._normKey(wanted);
                const foundKey = Object.keys(specs).find(k => this._normKey(k) === w);
                if (foundKey && typeof specs[foundKey] === "number") return Number(specs[foundKey]);

                return hasBaseLine ? Number(skill.system.niveau ?? 10) : 10;
                }

                return hasBaseLine ? Number(skill.system.niveau ?? 10) : 10;
            }


    async rollWeapon() {
        const actor = this.actor;
        const sys = this.system;
        
        const isMelee = (sys.munitions.max === 0);
        const cadence = sys.cadenceTir || 1; 

       const skillName = (sys.competence && sys.competence.trim() !== "")
  ? sys.competence
  : (isMelee ? "Arme de contact" : "Arme de poing");

// --- Alias UI -> nom réel de la compétence sur l'acteur ---
const norm = (s) => String(s ?? "").trim().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const ALIASES = {
  "armes lourdes": "arme lourde",
  "armes d'epaule": "arme d’épaule",
  "armes d’épaule": "arme d’épaule",
  "armes de contact": "arme de contact",
};

let resolvedSkillName = skillName;
const nk = norm(skillName);
if (ALIASES[nk]) resolvedSkillName = ALIASES[nk];

// --- specKey DOIT être un LET (pas const) ---
let specKey = sys.competenceSpec ?? "base";

// Arme de poing => pas de spé
if (norm(resolvedSkillName) === norm("Arme de poing")) specKey = "base";

// --- Si 9+ : si spé invalide, on force une option valide ---
try {
  const pack = game.packs.get("cops.competences");
  if (pack) {
    await pack.getIndex();
    const entry = pack.index.find(e => norm(e.name) === norm(resolvedSkillName));
    if (entry) {
      const doc = await pack.getDocument(entry._id);
      const at = Number(doc?.system?.specialisationAt ?? 0);
      const opts = Array.isArray(doc?.system?.specialisationOptions) ? doc.system.specialisationOptions : [];

      if (at === 9) {
        // pas de "base" en 9+
        if (!opts.includes(specKey)) {
          specKey = opts[0] ?? "";
          await this.update({ "system.competenceSpec": specKey }); // persiste
        }
      } else if (at > 0) {
        // normal : base autorisé
        const allowed = new Set(["base", ...opts]);
        if (!allowed.has(specKey)) {
          specKey = "base";
          await this.update({ "system.competenceSpec": specKey });
        }
      } else {
        // pas de spé => base
        if (specKey !== "base") {
          specKey = "base";
          await this.update({ "system.competenceSpec": specKey });
        }
      }
    }
  }
} catch (e) {
  console.warn("COPS | auto-fix competenceSpec failed", e);
}

const skillItem = this._findActorSkill(actor, resolvedSkillName);
const skillLevel = this._getSkillSeuil(actor, resolvedSkillName, specKey);


        // ✅ dés : carac vient de l’arme
        let caracKey = (sys.caracteristique && String(sys.caracteristique).trim() !== "")
        ? sys.caracteristique
        : "coordination";

        // (option) garder ton comportement mêlée => réflexes
        if (isMelee) caracKey = "reflexes";


        const caracValue = actor.system.caracteristiques[caracKey].value;
        const hasBlue = (skillItem?.system?.hasBlue || actor.system.caracteristiques[caracKey].hasBlue || sys.hasBlue);
        const weaponPrecision = sys.precision || 0;

        const adrValue = actor.system.ressources.adrenaline.value;
        const canUseAdr = (adrValue > 0) && (this.system.allowAdrenaline !== false);

        const myAttitude = actor.system.combat?.attitude || "standard";
        let attPoolBonus = 0;
        if (myAttitude === "ultra") attPoolBonus = 2;
        else if (myAttitude === "agressif") attPoolBonus = 1;
        else if (myAttitude === "prudent") attPoolBonus = -1;
        else if (myAttitude === "planque") attPoolBonus = -2;

        const targets = game.user.targets;
        // IMPORTANT: on conserve le Token (pas seulement l'Actor) pour pouvoir appliquer des dégâts
        // via un message MJ, y compris sur les tokens non-liés (ActorDelta).
        const targetToken = (targets.size > 0) ? targets.first() : null;
        let targetActor = targetToken ? targetToken.actor : null;
        let targetDefMod = 0;
        let targetAttName = "Normal";

        if (targetActor) {
            const tAtt = targetActor.system.combat?.attitude || "standard";
            if (tAtt === "ultra") { targetDefMod = -2; targetAttName="Ultra (-2 Succès requis)"; }
            else if (tAtt === "agressif") { targetDefMod = -1; targetAttName="Agressif (-1 Succès requis)"; }
            else if (tAtt === "prudent") { targetDefMod = 1; targetAttName="Prudent (+1 Succès requis)"; }
            else if (tAtt === "planque") { targetDefMod = 2; targetAttName="Planqué (+2 Succès requis)"; }
        }

        let ctInputHtml = "";
        if (cadence > 1) {
            ctInputHtml = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px; border-top:1px solid #555; padding-top:5px;">
                <label style="color:#ffcc00;">Nombre de Tirs (Max ${cadence})</label>
                <input type="number" id="nbTirs" value="1" min="1" max="${cadence}" style="width:50px; text-align:center; font-weight:bold; color:#ffcc00; background:#333; border:1px solid #ffcc00;">
            </div>
            <p style="font-size:0.75em; color:#aaa; margin-bottom:5px;">Malus : -1D au 1er, -2D au 2nd...</p>
            `;
        }

        const dialogContent = `
            <div style="text-align:center;">
                <p><strong>${this.name}</strong> (${isMelee ? 'CàC' : 'Tir'})</p>
                <div style="display:flex; justify-content:space-between; margin:5px 0;">
                    <label>Difficulté</label> <input type="number" id="seuil" value="${skillLevel}" style="width:50px; text-align:center;">
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <label>Modificateur Nombre de Dés</label> <input type="number" id="mod" value="0" style="width:50px; text-align:center;">
                </div>
                ${!isMelee ? (() => {
                    const lastRange = game.user.flags["cops"]?.lastRange ?? 2;
                    return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:5px;">
                    <label style="flex:1; min-width:0;">Portée du tir</label>
                    <select id="attackRange" style="flex:0 0 230px; min-width:230px; max-width:230px;">
                        <option value="1" ${lastRange === 1 ? "selected" : ""}>Courte (&lt; 10 m)</option>
                        <option value="2" ${lastRange === 2 ? "selected" : ""}>Moyenne (≤ portée arme)</option>
                        <option value="3" ${lastRange === 3 ? "selected" : ""}>Longue (≤ 2× portée arme)</option>
                    </select>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:5px;">
                    <label style="flex:1; min-width:0;">Modificateur MJ</label>
                    <input type="number" id="mjMod" value="0" style="flex:0 0 70px; width:70px; text-align:center;">
                </div>`;
                })() : ""}

                ${canUseAdr ? `<div style="margin-top:5px; text-align:left; background:rgba(255,255,0,0.1); padding:5px; border-radius:4px;">
                    <label style="cursor:pointer; display:flex; align-items:center;">
                        <input type="checkbox" id="useAdr" style="margin-right:8px;"> 
                        ⚡ Dépenser 1 Adrénaline (+1D)
                    </label>
                </div>` : ""}
                ${ctInputHtml}
                <div style="font-size:0.8em; color:#aaa; margin-top:5px; border-top:1px solid #444; padding-top:2px;">
                    <div>Mon Attitude : <strong>${myAttitude.toUpperCase()}</strong> (${attPoolBonus >= 0 ? '+' : ''}${attPoolBonus}D)</div>
                    ${targetActor ? `<div>Cible : <strong>${targetAttName}</strong> (${targetDefMod >= 0 ? '+' : ''}${targetDefMod} Diff)</div>` : ""}
                </div>
            </div>`;

        await DialogV2.wait({
            window: { title: "Paramètres d'Attaque", width: 560 },
            content: dialogContent,
            buttons: [{
                action: "fire", label: "FEU !", icon: "fas fa-crosshairs", default: true,
                callback: async (event, button, dialog) => {
                    const baseSeuil = parseInt(dialog.element.querySelector("#seuil").value);
                    const baseMod = parseInt(dialog.element.querySelector("#mod").value);

                    // Conditions de tir (évite une 2ème fenêtre)
                    let attackRange = 2;
                    let mjMod = 0;
                    if (!isMelee) {
                        const rangeEl = dialog.element.querySelector("#attackRange");
                        const mjEl = dialog.element.querySelector("#mjMod");
                        if (rangeEl) attackRange = Number(rangeEl.value);
                        if (mjEl) mjMod = Number(mjEl.value);

                        // Mémorisation de la portée pour la prochaine fois
                        await game.user.setFlag("cops", "lastRange", attackRange);
                    }

                    
                    let nbTirs = 1;
                    const nbTirsElement = dialog.element.querySelector("#nbTirs");
                    if (nbTirsElement) nbTirs = parseInt(nbTirsElement.value);

                    let adrBonus = 0;
                    const adrCheckbox = dialog.element.querySelector("#useAdr");
                    if ((this.system.allowAdrenaline !== false) && adrCheckbox && adrCheckbox.checked) {
                        adrBonus = 1;
                        await actor.update({ "system.ressources.adrenaline.value": adrValue - 1 });
                        ui.notifications.info("1 Point d'Adrénaline dépensé !");
                    }

                    if (!isMelee) {
                        const currentAmmo = sys.munitions.value;
                        if (currentAmmo < nbTirs) {
                            ui.notifications.warn(`Pas assez de munitions pour ${nbTirs} tirs ! (Reste: ${currentAmmo})`);
                            return; 
                        }
                        await this.update({ "system.munitions.value": currentAmmo - nbTirs });
                    }

                    const finalSeuil = baseSeuil;

                    // DEFINITION DES TAGS POUR BONUS STAGE
                    const actionTags = ["combat", skillName.toLowerCase()];
                    if (isMelee) actionTags.push("corps_a_corps", "contact");
                    else actionTags.push("tir", "feu");

                    for (let i = 1; i <= nbTirs; i++) {
                        const ctMalus = -(i - 1); 
                        
                        let currentPool = Math.max(0, caracValue + weaponPrecision + baseMod + attPoolBonus + ctMalus + adrBonus);
                        
                        let titleSuffix = (nbTirs > 1) ? ` (Tir ${i}/${nbTirs})` : "";

                        if (currentPool <= 0) {
                             ChatMessage.create({ 
                                content: `<div class="cops-chat-message"><h3>Attaque : ${this.name}${titleSuffix}</h3><div style="color:#b44; font-weight:bold;">ÉCHEC AUTOMATIQUE</div><div style="font-size:0.8em;">Pool réduit à 0 dés</div></div>`,
                                speaker: ChatMessage.getSpeaker({ actor: actor })
                            });
                        } else {
                            await rollCops(currentPool, finalSeuil, `Attaque : ${this.name}${titleSuffix}`, { 
                                actor: actor, target: targetToken,
                                blueDie: hasBlue, weapon: this, isAttack: true,
                                attackConditions: !isMelee ? { range: attackRange, mod: mjMod } : undefined,
                                type: "attaque", diff: finalSeuil,
                                tags: actionTags // Envoi des tags
                            });
                        }
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
            }]
        });
    }

    async rollSkill(options = {}) {
        const actor = this.actor;
        const sys = this.system;

        const forcedSeuil = (typeof options.seuil === "number") ? options.seuil : null;
        const forcedLabel = (typeof options.label === "string") ? options.label : null;
        const extraTags = Array.isArray(options.tags) ? options.tags : [];

        const defCarac = sys.caracteristique || "reflexes";

        const caracOptions = Object.keys(actor.system.caracteristiques).reduce((acc, key) => {
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            const selected = (key === defCarac) ? "selected" : "";
            return acc + `<option value="${key}" ${selected}>${label} (${actor.system.caracteristiques[key].value})</option>`;
        }, "");

        const adrValue = actor.system.ressources.adrenaline.value;
        const canUseAdr = (adrValue > 0) && (this.system.allowAdrenaline !== false);

        const defaultSeuil = forcedSeuil ?? sys.niveau;
        const displayName = forcedLabel ?? this.name;

        const content = `
        <div style="text-align:center;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <label>Caractéristique</label>
                <select id="caracChoice" style="width:120px;">${caracOptions}</select>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <label>Difficulté (Seuil)</label>
                <input type="number" id="seuil" value="${defaultSeuil}" style="width:50px; text-align:center;">
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <label>Modificateur Nombre de Dés</label>
                <input type="number" id="diceMod" value="0" style="width:50px; text-align:center;">
            </div>

            ${canUseAdr ? `<div style="text-align:left; background:rgba(255,255,0,0.1); padding:5px; border-radius:4px;">
                <label style="cursor:pointer; display:flex; align-items:center;">
                    <input type="checkbox" id="useAdr" style="margin-right:8px;"> 
                    ⚡ Dépenser 1 Adrénaline (+1D)
                </label>
            </div>` : ""}
        </div>`;

        await DialogV2.wait({
            window: { title: `Test de ${displayName}` },
            content: content,
            buttons: [{
            action: "roll",
            label: "Jeter",
            default: true,
            callback: async (e, b, d) => {
                const selectedCaracKey = d.element.querySelector("#caracChoice").value;
                const finalSeuil = parseInt(d.element.querySelector("#seuil").value);

                const caracData = actor.system.caracteristiques[selectedCaracKey];
                const caracValue = caracData.value;
                const skillBlue = (typeof options.hasBlue === "boolean") ? options.hasBlue : ((sys.hasBlueBase ?? sys.hasBlue) === true);
                const hasBlue = (skillBlue || caracData.hasBlue);

                let adrBonus = 0;
                const adrCheckbox = d.element.querySelector("#useAdr");
                if ((this.system.allowAdrenaline !== false) && adrCheckbox && adrCheckbox.checked) {
                adrBonus = 1;
                await actor.update({ "system.ressources.adrenaline.value": adrValue - 1 });
                ui.notifications.info("1 Point d'Adrénaline dépensé !");
                }

                // ✅ Nouveau : modificateur de dés
                const diceMod = parseInt(d.element.querySelector("#diceMod")?.value ?? "0", 10) || 0;

                // Nombre de dés final
                const finalDiceCount = Math.max(1, caracValue + adrBonus + diceMod);


                const tags = ["competence", selectedCaracKey, this.name.toLowerCase(), ...extraTags];

                await rollCops(
                    finalDiceCount,
                    finalSeuil,
                    `Test : ${displayName} (${selectedCaracKey})`,
                    { actor: actor, blueDie: hasBlue, type: "competence", diff: finalSeuil, tags }
                );

            }
            }]
        });
     }


    async reload() {
        if (this.type !== "arme" && this.type !== "weapon") return;
        const max = this.system.munitions.max;
        if (max > 0) {
            await this.update({ "system.munitions.value": max });
            ui.notifications.info(`${this.name} rechargée (${max}/${max}).`);
        } else {
            ui.notifications.warn("Cette arme n'utilise pas de munitions.");
        }
    }
}