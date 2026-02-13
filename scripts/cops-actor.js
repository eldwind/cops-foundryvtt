
function mergeSpecialisations(baseSpecs = [], trainingSpecs = []) {
  const map = new Map();
  for (const s of baseSpecs || []) {
    const key = (s.name ?? s.label ?? "").trim().toLowerCase();
    map.set(key, foundry.utils.deepClone(s));
  }
  for (const s of trainingSpecs || []) {
    const key = (s.name ?? s.label ?? "").trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, foundry.utils.deepClone(s));
    } else {
      map.get(key).value = s.value;
    }
  }
  return Array.from(map.values());
}


import { rollCops } from "./dice.js";
const { DialogV2 } = foundry.applications.api;

// DONNÉES STATIQUES
const STARTER_SKILLS = [
    { name: "Arme d'épaule", niveau: 8, carac: "coordination" }, 
    { name: "Arme de contact", niveau: 8, carac: "coordination" }, 
    { name: "Arme de poing", niveau: 7, carac: "coordination" },
    { name: "Athlétisme", niveau: 7, carac: "carrure" }, 
    { name: "Bureaucratie", niveau: 8, carac: "education" }, 
    { name: "Conduite", niveau: 7, spec: "Voiture", carac: "reflexes" },
    { name: "Discrétion", niveau: 7, carac: "reflexes" }, 
    { name: "Informatique", niveau: 7, carac: "education" }, 
    { name: "Instinct de flic", niveau: 9, carac: "perception" },
    { name: "Premiers secours", niveau: 8, carac: "education" }, 
    { name: "Scène de crime", niveau: 7, carac: "perception" }
];

const CARACS_LIST = ["carrure", "coordination", "education", "reflexes", "sangFroid", "charme", "perception"];

// TEXTES D'AMBIANCE
const CONTACT_HINTS = {
    "ghetto": "Gang, organisme social ou un petit commerce de quartier",
    "ouvrier": "Syndicat ou un organisme social ou un petit commerce de quartier",
    "papa": "Parti politique ou une grosse entreprise ou dans l'administration",
    "riche": "Parti politique ou un milieu branché (mode/showbiz) ou dans le milieu de la finance",
    "rue": "Gang, organisme social ou un petit commerce de quartier",
    "minimale": "Administration, une association de quartier ou un petit commerce de quartier",
    "lycee": "Avocat, un journaliste, ou un membre d'une administration",
    "sup": "Milieu de la haute finance, dans un cabinet d'avocats ou à la direction d'un organe de presse",
    "academie": "Un parti politique, chez des cadres, ou d'autres services de la police de LA",
    "armee": "L'administration, chez des cadres, ou dans d'autres services de la police de LA",
    "concours": "Chez les criminels, Des cadres ou d'autres services de la police de LA",
    "federale": "Des criminels, dans d'autres services De la police de LA, ou dans un parti politique",
    "sportif": "Des journalistes, dans le milieu de la finance, ou dans un parti politique",
    "piston": "Un parti politique, chez les cadres, ou dans un autre service De la police de LA"
};

export class CopsActor extends Actor {

    prepareDerivedData() {
        super.prepareDerivedData();
        const data = this.system;
        if (!data.caracteristiques || !data.caracteristiques.carrure) return;
        const carrure = data.caracteristiques.carrure.value || 2; 
        let basePV = (this.type === "character") ? 20 : 10;
        if (data.ressources?.pv) data.ressources.pv.max = basePV + (carrure * 3);
    }

    async _onCreate(data, options, userId) {
        await super._onCreate(data, options, userId);
        if (userId !== game.user.id) return;

        // --- CORRECTION PV INITIAL : REMPLISSAGE AU MAX À LA CRÉATION ---
        if (this.type === "character") {
             const maxPV = this.system.ressources.pv.max;
             await this.update({ "system.ressources.pv.value": maxPV });
        }
    }

    async _onUpdate(changed, options, userId) {
        await super._onUpdate(changed, options, userId);
        if (game.user.id !== userId) return;
        if (changed.system?.combat) await this._manageCombatEffects();
    }

    async _manageCombatEffects() {
        const combatData = this.system.combat;
        const mapAttitude = { "ultra": { img: "icons/svg/skull.svg", name: "Ultra-Violent" }, "agressif": { img: "icons/svg/sword.svg", name: "Agressif" }, "standard": null, "prudent": { img: "icons/svg/shield.svg", name: "Prudent" }, "planque": { img: "icons/svg/castle.svg", name: "Planqué" } };
        const desiredAttitude = mapAttitude[combatData.attitude];
        const existingAttitude = this.effects.find(e => e.statuses.has("cops-attitude"));
        if (desiredAttitude) { if (existingAttitude && existingAttitude.img !== desiredAttitude.img) { await existingAttitude.update({ img: desiredAttitude.img, name: desiredAttitude.name }); } else if (!existingAttitude) { await this.createEmbeddedDocuments("ActiveEffect", [{ name: desiredAttitude.name, img: desiredAttitude.img, statuses: ["cops-attitude"], flags: { core: { overlay: false } } }]); } } else if (existingAttitude) { await existingAttitude.delete(); }
        const isTerre = (combatData.etat === "terre");
        const existingTerre = this.effects.find(e => e.statuses.has("cops-terre"));
        if (isTerre && !existingTerre) { await this.createEmbeddedDocuments("ActiveEffect", [{ name: "À Terre", img: "icons/svg/falling.svg", statuses: ["cops-terre"], "flags.core.overlay": true }]); } else if (!isTerre && existingTerre) await existingTerre.delete();
        const isChoc = (combatData.etat === "choc");
        const existingChoc = this.effects.find(e => e.statuses.has("cops-choc"));
        if (isChoc && !existingChoc) { await this.createEmbeddedDocuments("ActiveEffect", [{ name: "État de Choc", img: "icons/svg/lightning.svg", statuses: ["cops-choc"] }]); } else if (!isChoc && existingChoc) await existingChoc.delete();
    }

    async rollInitiative(options={}) {
        const reflex = this.system.caracteristiques?.reflexes?.value || 0;
        const attitude = this.system.combat?.attitude || "standard";
        let attMod = 0;
        if (attitude === "ultra") attMod = 2; else if (attitude === "agressif") attMod = 1; else if (attitude === "prudent") attMod = -1; else if (attitude === "planque") attMod = -2;
        const total = reflex + attMod;
        if (game.combat) { const combatant = game.combat.combatants.find(c => c.actorId === this.id); if (combatant) await game.combat.setInitiative(combatant.id, total); }
        ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<div class="cops-chat-message"><h3>Initiative</h3><div style="font-size:1.4em; color:#fff;">${total}</div><div style="font-size:0.8em; color:#aaa;">Réflexes (${reflex}) + Attitude ${attitude} (${attMod})</div></div>` });
        return this;
    }

    async recoverFromTerre() {
        if (this.system.combat.etat !== "terre") return ui.notifications.info("Vous n'êtes pas à terre.");
        const combat = this.system.combat;
        const diffBase = combat.diffChoc || 9;
        const currentRound = (game.combat && game.combat.round > 0) ? game.combat.round : 1;
        const roundChute = this.getFlag("cops", "roundTombe") || currentRound;
        if (currentRound <= roundChute) { return ui.notifications.warn(`Action Impossible : Vous êtes tombé ce round-ci. Attendez le suivant.`); }
        const toursPasses = Math.max(0, currentRound - roundChute);
        const finalDiff = Math.max(2, diffBase - toursPasses);
        const content = `<div style="text-align:center;"><h3 style="color:#b44; font-weight:bold;">VOUS ÊTES À TERRE !</h3><p><strong>Difficulté : ${finalDiff}</strong> (${diffBase} - ${toursPasses} tours)</p><p style="font-size:0.9em; color:#aaa;">Choisissez la caractéristique à tester :</p></div>`;
        await DialogV2.wait({ window: { title: "Récupération" }, content: content, buttons: [{ action: "carrure", label: "CARRURE", icon: "fas fa-fist-raised", callback: async () => { const pool = this.system.caracteristiques.carrure.value; const hasBlue = this.system.caracteristiques.carrure.hasBlue; await rollCops(pool, finalDiff, "Tentative de Récupération (Carrure)", { actor: this, blueDie: hasBlue, type: "recuperation", diff: finalDiff }); } }, { action: "sangfroid", label: "SANG-FROID", icon: "fas fa-brain", callback: async () => { const pool = this.system.caracteristiques.sangFroid.value; const hasBlue = this.system.caracteristiques.sangFroid.hasBlue; await rollCops(pool, finalDiff, "Tentative de Récupération (Sang-froid)", { actor: this, blueDie: hasBlue, type: "recuperation", diff: finalDiff }); } }] });
    }

    // --- LANCEUR DU WIZARD V2 ---
    async applyCreationWizard() {
    // anti-doublon : si déjà en cours d'ouverture, stop
    if (this.getFlag("cops", "chargenOpening")) return;
    await this.setFlag("cops", "chargenOpening", true);

    try {
        // si une instance du wizard est déjà ouverte pour cet actor, on la focus
        const inst = [...foundry.applications.instances.values()];
        const existing = inst.find(a =>
        a?.constructor?.name === "CopsCreationWizard" &&
        a?.options?.window?.actorId === this.id
        );
        if (existing) {
        existing.bringToTop?.();
        return;
        }

        // sinon on ouvre
        await CopsCreationWizard.wait({
        window: {
            title: "Dossier de Recrutement C.O.P.S",
            width: 850,
            height: 750,
            resizable: true,
            actorId: this.id
        },
        content: ""
        });
    } finally {
        await this.unsetFlag("cops", "chargenOpening");
    }
    }

}

// --- CLASSE DÉDIÉE WIZARD V2 ---
class CopsCreationWizard extends DialogV2 {

     _copsAllowClose = false;   // 👈 verrou par défaut
    
    static async wait(options={}) {
        const wizard = new CopsCreationWizard({
            window: options.window,
            content: `
            <style>
              /* Les tabs ne doivent pas gérer le scroll : c'est section.content qui scrolle */
                .cops-wizard .tab { display: none; padding: 0 10px; }

                .cops-wizard .tab.active { display: block; }
                
                .cops-wizard .sheet-tabs { 
                    display: flex; border-bottom: 2px solid #444; margin-bottom: 15px; gap: 5px; 
                    background: rgba(0,0,0,0.2); padding: 5px; border-radius: 5px;
                }
                .cops-wizard .sheet-tabs .item { 
                    padding: 8px 15px; cursor: pointer; background: rgba(255,255,255,0.05); 
                    border-radius: 4px; color: #aaa; transition: all 0.2s; flex: 1; text-align: center;
                }
                .cops-wizard .sheet-tabs .item:hover { background: rgba(255,255,255,0.15); color: #fff; }
                .cops-wizard .sheet-tabs .item.active { background: #222; color: #ffcc00; border: 1px solid #ffcc00; font-weight: bold; }
                
                .drop-zone { 
                    border: 2px dashed #666; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 10px; 
                    cursor: pointer; transition: all 0.2s; font-size: 1.1em; color:#aaa; 
                    background: rgba(0,0,0,0.2); min-height: 80px;
                    display: flex; flex-direction: column; justify-content: center; align-items: center;
                }
                .drop-zone.hover { background: rgba(255,255,255,0.1); border-color: #fff; color: #fff; }
                .drop-zone-9 { border-color: #448; background: rgba(0,0,80,0.2); }
                .drop-zone-8 { border-color: #848; background: rgba(80,0,80,0.2); }

                .dim-btn.active { background: #d00; color: #fff; border-color: #f00; box-shadow: 0 0 5px #f00; }
                
                /* LIGNES DE CARACTÉRISTIQUES */
                .carac-row { 
                    display: flex; justify-content: space-between; align-items: center; 
                    background: rgba(255,255,255,0.05); padding: 8px 15px; margin-bottom: 5px; 
                    border-radius: 4px; border: 1px solid #444;
                }
                .carac-label { font-weight: bold; text-transform: uppercase; font-size: 1.1em; color: #ddd; }
                .carac-controls { display: flex; align-items: center; gap: 15px; }
                .carac-controls button { 
                    width: 35px; height: 35px; line-height: 20px; padding: 0; 
                    text-align: center; font-weight: bold; font-size: 1.4em; 
                    border-radius: 4px; border:none; cursor: pointer; 
                }
                .carac-value { width: 40px; text-align: center; font-size: 1.5em; font-weight: bold; color: #fff; }

                .contact-row { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; margin-bottom: 8px; }


                /* Cache le footer natif DialogV2 (celui du bouton vide noop) */
                dialog.cops-wizard-app > footer {
                display: none !important;
                }

/* === FOOTER CUSTOM : Retour | Annuler (centre) | Suivant/Terminer === */
.cops-wizard-app .cops-wizard > footer.cops-wizard-footer{
  display: grid !important;
  grid-template-columns: 140px 1fr auto !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 10px !important;
  border-top: 1px solid #444 !important;
  background: rgba(0,0,0,0.25) !important;
}

/* Retour à gauche */
.cops-wizard-app .cops-wizard-footer [data-action="prevStep"]{
  justify-self: start !important;
}

/* Annuler centré */
.cops-wizard-app .cops-wizard-footer [data-action="cancelWizard"]{
  justify-self: center !important;
}

/* Bloc droite (Suivant / Terminer) */
.cops-wizard-app .cops-wizard-footer .cops-wizard-footer-right{
  justify-self: end !important;
  display: flex !important;
  gap: 10px !important;
  align-items: center !important;
}



            </style>

            <div class="cops-wizard" style="height: 100%; display:flex; flex-direction:column;">
                <nav class="sheet-tabs tabs" style="flex: 0 0 auto;">
                    <a class="item active" data-tab="caracs"><i class="fas fa-chart-bar"></i> Caracs (21)</a>
                    <a class="item" data-tab="profil"><i class="fas fa-id-card"></i> Profil</a>
                    <a class="item" data-tab="history"><i class="fas fa-history"></i> Historique</a>
                    <a class="item" data-tab="training"><i class="fas fa-dumbbell"></i> Entraînement (10 pts)</a>
                </nav>

                <section class="content">
                    
                    <div class="tab active" data-tab="caracs">
                        <div style="text-align:center; margin-bottom:15px; padding:10px; border-bottom:1px solid #444; background:rgba(0,0,0,0.2); border-radius:5px;">
                            Points à répartir : <strong id="carac-points" style="color:#4f4; font-size:1.8em;">7</strong> / 21
                        </div>
                        <div id="caracs-list"></div>
                    </div>

                    <div class="tab" data-tab="profil">
                        <h3 style="border-bottom:1px solid #444; color:#ffcc00;">Spécialisations</h3>
                        <div style="margin-bottom:15px;">
                            <label style="font-weight:bold;">Corps à Corps (Niv 7)</label>
                            <div style="display:flex; gap:10px; margin-top:5px;">
                                <label><input type="radio" name="cacSpec" value="Coups" checked> Coups</label>
                                <label><input type="radio" name="cacSpec" value="Projections"> Projections</label>
                                <label><input type="radio" name="cacSpec" value="Immobilisations"> Immobilisations</label>
                            </div>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="font-weight:bold;">Social (Niv 7)</label>
                            <div style="display:flex; gap:10px; margin-top:5px;">
                                <label><input type="radio" name="socialSkill" value="Éloquence" checked> Éloquence</label>
                                <label><input type="radio" name="socialSkill" value="Intimidation"> Intimidation</label>
                                <label><input type="radio" name="socialSkill" value="Rhétorique"> Rhétorique</label>
                            </div>
                        </div>
                        <div style="margin-top:10px;">
                        <label style="display:block; margin-bottom:4px; font-weight:bold;">Grade</label>
                        <input type="text" id="wiz-grade" value="Détective" style="width:100%;">
                        </div>

                    </div>

                    <div class="tab" data-tab="history">
                        <div style="margin-bottom:10px; border:1px solid #444; padding:10px; border-radius:4px; background:rgba(255,255,255,0.02);">
                            <label style="font-weight:bold; color:#00ccff;">1. Origine Sociale</label>
                            <select id="sel-origine" style="width:100%; margin-bottom:5px;">
                                <option value="ghetto">Enfant du ghetto</option>
                                <option value="ouvrier">Fils d'ouvrier</option>
                                <option value="papa">Fils à papa</option>
                                <option value="riche">Gosse de riche</option>
                            </select>
                            <div style="font-size:0.8em; color:#aaa; font-style:italic; margin-bottom:5px;">Gain : Contact Gang/Social (Niv 2)</div>
                            <div class="contact-row">
                                <input type="text" id="contact-origine-nom" placeholder="Nom">
                                <input type="text" id="contact-origine-dom" placeholder="Domaine">
                            </div>
                            <select id="contact-origine-type" style="width:100%; margin-top:6px;">
                            <option value="informateur">Informateur</option>
                            <option value="allie">Allié</option>
                            </select>

                        </div>
                        <div style="margin-bottom:10px; border:1px solid #444; padding:10px; border-radius:4px; background:rgba(255,255,255,0.02);">
                            <label style="font-weight:bold; color:#00ccff;">2. Éducation</label>
                            <select id="sel-educ" style="width:100%; margin-bottom:5px;">
                                <option value="rue">La Rue</option>
                                <option value="minimale">Minimale</option>
                                <option value="lycee">Lycée</option>
                                <option value="sup">Études Supérieures</option>
                            </select>
                            <div style="font-size:0.8em; color:#aaa; font-style:italic; margin-bottom:5px;">Gain : Contact + 2 Bonus Compétences (Niv 9)</div>
                                <div style="margin-bottom:6px;">
                                <label style="margin-right:10px;">
                                    <input type="radio" name="educContactMode" value="create" checked>
                                    Créer un nouveau contact
                                </label>
                                <label>
                                    <input type="radio" name="educContactMode" value="upgrade">
                                    Améliorer un contact existant
                                </label>
                                </div>

                                <div class="contact-row" id="educ-create-row">
                                <input type="text" id="contact-educ-nom" placeholder="Nom">
                                <input type="text" id="contact-educ-dom" placeholder="Domaine">
                                </div>
                                <select id="contact-educ-type" style="width:100%; margin-top:6px;">
                                <option value="informateur">Informateur</option>
                                <option value="allie">Allié</option>
                                </select>


                                <div class="contact-row" id="educ-upgrade-row" style="display:none;">
                                <select id="contact-educ-existing" style="width:100%;">
                                    <option value="">— Choisir un contact —</option>
                                </select>
                                <div style="font-size:0.8em; color:#aaa; align-self:center;">+1 niveau</div>
                                </div>

                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:5px;">
                                <select id="edu-bonus-1" style="width:100%;"></select>
                                <select id="edu-bonus-2" style="width:100%;"></select>
                            </div>

                            <div id="edu-spec-wrap-1" style="margin-top:8px;"></div>
                            <div id="edu-spec-wrap-2" style="margin-top:8px;"></div>


                            <!-- === Spécialisation : Conduite / Corps à corps (déjà spécialisées) — BONUS 1 === -->
                                <div id="edu-bonus-1-alreadySpec-block" style="display:none; margin-top:10px; padding:8px; border:1px dashed #444; border-radius:4px; background:rgba(0,0,0,0.15);">
                                <div style="font-weight:bold; margin-bottom:6px; color:#ffcc00;">
                                    <span id="edu-bonus-1-alreadySpec-title">Spécialisation</span>
                                </div>

                                <div style="margin-bottom:6px;">
                                    <label style="margin-right:12px;">
                                    <input type="radio" name="eduBonus1SpecMode" value="existing" checked>
                                    Améliorer une spé existante
                                    </label>
                                    <label>
                                    <input type="radio" name="eduBonus1SpecMode" value="new">
                                    Débloquer une nouvelle spé
                                    </label>
                                </div>

                                <div id="edu-bonus-1-alreadySpec-existing-wrap">
                                    <select id="edu-bonus-1-alreadySpec-existing" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                    </select>
                                </div>

                                <div id="edu-bonus-1-alreadySpec-new-wrap" style="display:none; margin-top:6px;">
                                    <select id="edu-bonus-1-alreadySpec-new" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                    </select>
                                </div>

                                <div style="font-size:0.8em; color:#aaa; margin-top:6px;">
                                    Le général n’est pas améliorable : tu choisis la spécialisation ciblée.
                                </div>
                                </div>

                                <!-- === Spécialisation : Conduite / Corps à corps (déjà spécialisées) — BONUS 2 === -->
                                <div id="edu-bonus-2-alreadySpec-block" style="display:none; margin-top:10px; padding:8px; border:1px dashed #444; border-radius:4px; background:rgba(0,0,0,0.15);">
                                <div style="font-weight:bold; margin-bottom:6px; color:#ffcc00;">
                                    <span id="edu-bonus-2-alreadySpec-title">Spécialisation</span>
                                </div>

                                <div style="margin-bottom:6px;">
                                    <label style="margin-right:12px;">
                                    <input type="radio" name="eduBonus2SpecMode" value="existing" checked>
                                    Améliorer une spé existante
                                    </label>
                                    <label>
                                    <input type="radio" name="eduBonus2SpecMode" value="new">
                                    Débloquer une nouvelle spé
                                    </label>
                                </div>

                                <div id="edu-bonus-2-alreadySpec-existing-wrap">
                                    <select id="edu-bonus-2-alreadySpec-existing" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                    </select>
                                </div>

                                <div id="edu-bonus-2-alreadySpec-new-wrap" style="display:none; margin-top:6px;">
                                    <select id="edu-bonus-2-alreadySpec-new" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                    </select>
                                </div>

                                <div style="font-size:0.8em; color:#aaa; margin-top:6px;">
                                    Le général n’est pas améliorable : tu choisis la spécialisation ciblée.
                                </div>
                                </div>


                              <!-- Spécialisation Éducation : Connaissance (9+) -->
                                <div id="edu-connaissance-spec-block" style="display:none; margin-top:8px;">
                                <label style="font-weight:bold;">Spécialisation Connaissance</label>

                                <!-- Pick 1 : free text -->
                                <input id="edu-connaissance-spec-1"
                                        type="text"
                                        placeholder="Spécialisation (texte libre)"
                                        style="width:100%;"
                                        list="edu-connaissance-spec-datalist">

                                <!-- suggestions optionnelles si le compendium en fournit -->
                                <datalist id="edu-connaissance-spec-datalist"></datalist>

                                <!-- Pick 2 : choix “améliorer existante” vs “nouvelle spé” -->
                                <div id="edu-connaissance-bonus2-block" style="display:none; margin-top:10px; padding:8px; border:1px dashed #444; border-radius:4px; background:rgba(0,0,0,0.15);">
                                    <div style="font-weight:bold; margin-bottom:6px; color:#ffcc00;">
                                    Connaissance (bonus 2) : cible de l'amélioration
                                    </div>

                                    <div style="margin-bottom:6px;">
                                    <label style="margin-right:12px;">
                                        <input type="radio" name="eduConnaissanceBonus2Mode" value="existing" checked>
                                        Améliorer la spé existante
                                    </label>
                                    <label>
                                        <input type="radio" name="eduConnaissanceBonus2Mode" value="new">
                                        Débloquer une nouvelle spé
                                    </label>
                                    </div>

                                    <div id="edu-connaissance-bonus2-new-wrap" style="display:none; margin-top:6px;">
                                    <input id="edu-connaissance-spec-2"
                                            type="text"
                                            placeholder="Nouvelle spécialisation (texte libre)"
                                            style="width:100%;"
                                            list="edu-connaissance-spec-datalist">
                                    </div>

                                    <div style="font-size:0.8em; color:#aaa; margin-top:6px;">
                                    Si tu choisis “nouvelle”, tu saisis un second texte libre.
                                    </div>
                                </div>

                                <div style="font-size:0.8em; color:#aaa; padding-top:6px;">
                                    Connaissance démarre à 9 → spécialisation obligatoire.
                                </div>
                                </div>




                            <!-- Spécialisation Éducation : Arme de contact (palier) -->
                                <div id="edu-armecontact-spec-block" style="display:none; margin-top:10px; padding:8px; border:1px dashed #444; border-radius:4px; background:rgba(0,0,0,0.15);">
                                <div style="font-weight:bold; margin-bottom:6px; color:#ffcc00;">
                                    Arme de contact : choisir une spécialisation
                                </div>
                                <select id="edu-armecontact-spec" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                </select>
                                <div style="font-size:0.8em; color:#aaa; margin-top:6px;">
                                    Obligatoire si l’Éducation baisse “Arme de contact” jusqu’au palier.
                                </div>
                                </div>


                            <div id="edu-informatique-specs" style="display:none; margin-top:10px;">
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                                <div id="edu-bonus-1-spec-wrap" style="display:none;">
                                <label style="font-size:0.85em; color:#aaa;">Spécialisation Informatique (bonus 1)</label>
                                <select id="edu-bonus-1-spec" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                </select>
                                </div>

                                <div id="edu-bonus-2-spec-wrap" style="display:none;">
                                <label style="font-size:0.85em; color:#aaa;">Spécialisation Informatique (bonus 2)</label>
                                <select id="edu-bonus-2-spec" style="width:100%;">
                                    <option value="">— Choisir —</option>
                                </select>
                                </div>
                            </div>

                            <div style="font-size:0.8em; color:#888; margin-top:6px;">
                                La spécialisation ne sera appliquée que si Informatique atteint le palier 5 pendant la création.
                            </div>
                            </div>

                        </div>
                        <div style="margin-bottom:5px; border:1px solid #444; padding:10px; border-radius:4px; background:rgba(255,255,255,0.02);">
                            <label style="font-weight:bold; color:#00ccff;">3. Entrée au C.O.P.S</label>
                            <select id="sel-entree" style="width:100%; margin-bottom:5px;">
                                <option value="academie">Académie de Police</option>
                                <option value="armee">Armée / Forces Spéciales</option>
                                <option value="concours">Concours / Terrain</option>
                                <option value="federale">Équivalence Fédérale</option>
                                <option value="sportif">Sportif</option>
                                <option value="piston">Piston</option>
                            </select>
                            
                            <div id="federale-choice" style="display:none; margin-bottom:5px; text-align:center; background:rgba(255,255,255,0.05); padding:5px; border-radius:4px;">
                                <label style="margin-right:15px; cursor:pointer;"><input type="radio" name="fedOption" value="1" checked> 1 Anc / 1 Adr</label>
                                <label style="cursor:pointer;"><input type="radio" name="fedOption" value="2"> 2 Anc / 0 Adr</label>
                            </div>

                            <div id="desc-entree" style="font-size:0.8em; color:#aaa; font-style:italic; margin-bottom:5px;">Ressources : Anc 2 / Adr 0</div>
                            <div style="margin-bottom:6px;">
                                <label style="margin-right:10px;">
                                    <input type="radio" name="entree1ContactMode" value="create" checked>
                                    Créer
                                </label>
                                <label>
                                    <input type="radio" name="entree1ContactMode" value="upgrade">
                                    Améliorer
                                </label>
                                </div>

                                <div class="contact-row" id="entree1-create-row">
                                <input type="text" id="contact-entree1-nom" placeholder="Nom Contact 1">
                                <input type="text" id="contact-entree1-dom" placeholder="Domaine 1">
                                </div>
                                <select id="contact-entree1-type" style="width:100%; margin-top:6px;">
                                <option value="informateur">Informateur</option>
                                <option value="allie">Allié</option>
                                </select>


                                <div class="contact-row" id="entree1-upgrade-row" style="display:none;">
                                <select id="contact-entree1-existing" style="width:100%;">
                                    <option value="">— Choisir un contact —</option>
                                </select>
                                <div style="font-size:0.8em; color:#aaa; align-self:center;">+1 niveau</div>
                            </div>
                        <div style="margin-bottom:6px;">
                            <label style="margin-right:10px;">
                                <input type="radio" name="entree2ContactMode" value="create" checked>
                                Créer
                            </label>
                            <label>
                                <input type="radio" name="entree2ContactMode" value="upgrade">
                                Améliorer
                            </label>
                            </div>

                            <div class="contact-row" id="entree2-create-row">
                            <input type="text" id="contact-entree2-nom" placeholder="Nom Contact 2">
                            <input type="text" id="contact-entree2-dom" placeholder="Domaine 2">
                            </div>

                            <select id="contact-entree2-type" style="width:100%; margin-top:6px;">
                            <option value="informateur">Informateur</option>
                            <option value="allie">Allié</option>
                            </select>

                            <div class="contact-row" id="entree2-upgrade-row" style="display:none;">
                            <select id="contact-entree2-existing" style="width:100%;">
                                <option value="">— Choisir un contact —</option>
                            </select>
                            <div style="font-size:0.8em; color:#aaa; align-self:center;">+1 niveau</div>
                        </div>

                        </div>

                         <div id="contacts-free2" style="margin-top:10px; border:1px solid #444; padding:10px; border-radius:4px; background:rgba(255,255,255,0.02);">
                    <label style="font-weight:bold; color:#00ccff;">4. Contacts (2 points libres)</label>

                    <div style="font-size:0.85em; color:#aaa; font-style:italic; margin-bottom:8px;">
                        Utilise 2 points : créer un contact (+1) ou améliorer un contact existant (+1).<br>
                        <strong>Points restants :</strong> <span id="free-contacts-remaining" data-remaining="2">2</span> / 2
                    </div>

                    <!-- Point libre #1 -->
                    <div style="border-top:1px dashed #333; padding-top:8px; margin-top:8px;">
                        <div style="font-weight:bold; margin-bottom:6px;">Point libre #1</div>

                        <div style="margin-bottom:6px;">
                        <label style="margin-right:10px;">
                            <input type="radio" name="free1ContactMode" value="create" checked>
                            Créer
                        </label>
                        <label>
                            <input type="radio" name="free1ContactMode" value="upgrade">
                            Améliorer
                        </label>
                        </div>

                        <div class="contact-row" id="free1-create">
                        <input type="text" id="contact-free1-nom" placeholder="Nom">
                        <input type="text" id="contact-free1-dom" placeholder="Domaine (conseillé)">
                        </div>

                        <select id="contact-free1-type" style="width:100%; margin-top:6px;">
                        <option value="informateur">Informateur</option>
                        <option value="allie">Allié</option>
                        </select>

                        <div class="contact-row" id="free1-upgrade" style="display:none;">
                        <select id="contact-free1-existing" style="width:100%;">
                            <option value="">— Choisir un contact —</option>
                        </select>
                        <div style="font-size:0.8em; color:#aaa; padding-top:6px;">+1 niveau</div>
                        </div>
                    </div>

                    <!-- Point libre #2 -->
                    <div style="border-top:1px dashed #333; padding-top:8px; margin-top:10px;">
                        <div style="font-weight:bold; margin-bottom:6px;">Point libre #2</div>

                        <div style="margin-bottom:6px;">
                        <label style="margin-right:10px;">
                            <input type="radio" name="free2ContactMode" value="create" checked>
                            Créer
                        </label>
                        <label>
                            <input type="radio" name="free2ContactMode" value="upgrade">
                            Améliorer
                        </label>
                        </div>

                        <div class="contact-row" id="free2-create">
                        <input type="text" id="contact-free2-nom" placeholder="Nom">
                        <input type="text" id="contact-free2-dom" placeholder="Domaine (conseillé)">
                        </div>

                        <select id="contact-free2-type" style="width:100%; margin-top:6px;">
                        <option value="informateur">Informateur</option>
                        <option value="allie">Allié</option>
                        </select>

                        <div class="contact-row" id="free2-upgrade" style="display:none;">
                        <select id="contact-free2-existing" style="width:100%;">
                            <option value="">— Choisir un contact —</option>
                        </select>
                        <div style="font-size:0.8em; color:#aaa; padding-top:6px;">+1 niveau</div>
                        </div>
                    </div>
                    </div>
                    </div>



                    <div class="tab" data-tab="training">
                        <div style="text-align:center; margin-bottom:10px; position:sticky; top:0; background:#333; z-index:10; padding:10px; border-bottom:2px solid #ffcc00;">
                            <span style="font-size:1.2em;">Points Restants : <strong id="budget-display" style="color:#4f4; font-size:1.5em;">10</strong></span>
                            <div style="font-size:0.8em; color:#aaa;">Max -5 pts en Diminution (Base)</div>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                            <div>
                                <h4 style="color:#aaa; margin:0 0 5px 0;">Base</h4>
                                <div id="base-skills-list" style="max-height:580px; overflow-y:auto; padding-right:5px;"></div>
                            </div>
                            <div>
                                <h4 style="color:#aaa; margin:0 0 5px 0;">Achat</h4>
                                <button type="button" data-action="openCompendium" style="width:100%; margin-bottom:10px; background:#444; color:#fff; font-size:0.9em; padding:8px;">
                                    <i class="fas fa-atlas"></i> Ouvrir Compendium
                                </button>
                                <div class="drop-zone drop-zone-9" data-cost="1" data-level="9">
                                    <i class="fas fa-download" style="font-size:1.5em; margin-bottom:5px;"></i>
                                    <span>Glisser ici -> <strong>Niv 9 (1 pt)</strong></span>
                                </div>
                                <div class="drop-zone drop-zone-8" data-cost="2" data-level="8">
                                    <i class="fas fa-download" style="font-size:1.5em; margin-bottom:5px;"></i>
                                    <span>Glisser ici -> <strong>Niv 8 (2 pts)</strong></span>
                                </div>
                                <div id="bought-skills-list" style="font-size:0.9em; margin-top:10px; max-height:580px; overflow-y:auto; padding-right:5px;"></div>
                            </div>
                        </div>
                    </div>
                </section>

             <footer class="cops-wizard-footer"
                style="display:grid; grid-template-columns: 140px 1fr auto; align-items:center; gap:10px; padding:10px; border-top:1px solid #444; background:rgba(0,0,0,0.25);">

                <button type="button" data-action="prevStep" style="justify-self:start; width:auto;">
                    <i class="fas fa-arrow-left"></i> Retour
                </button>

                <button type="button" data-action="cancelWizard" style="justify-self:center; width:auto;">
                    <i class="fas fa-times"></i> Annuler
                </button>

                <div class="cops-wizard-footer-right" style="justify-self:end; display:flex; gap:10px; align-items:center;">
                    <button type="button" data-action="nextStep" style="width:auto;">
                    <i class="fas fa-arrow-right"></i> Suivant
                    </button>
                    <button type="button" data-action="finishWizard" style="display:none; width:auto;">
                    <i class="fas fa-check"></i> Terminer & Créer
                    </button>
                </div>
                </footer>




            </div>`,
                buttons: [{
                action: "noop",
                label: "",
                icon: "",
                callback: () => {}
                }]




        });

        wizard._copsAllowClose = false;

        wizard._creationCompleted = false;

        // Affiche le wizard et renvoie l'instance
            wizard.render(true);
            const clampWizardToViewport = () => {
            const margin = 80;
            const maxW = Math.max(700, window.innerWidth - margin);
            const maxH = Math.max(600, window.innerHeight - margin);

            const targetW = 950;
            const targetH = 1250;

            const width  = Math.min(targetW, maxW);
            const height = Math.min(targetH, maxH);

            const left = Math.max(0, (window.innerWidth  - width) / 2);
            const top  = Math.max(0, (window.innerHeight - height) / 2);

            wizard.setPosition({ width, height, left, top });
            };


        requestAnimationFrame(() => {
            try { clampWizardToViewport(); } catch (e) { console.warn("COPS | clamp failed", e); }
        });

            return wizard;
 
    }

    // Empêche la fermeture tant qu'on n'a pas explicitement terminé
        async close(options = {}) {
        if (!this._copsAllowClose) {
            // debug utile
            console.warn("COPS | Wizard close blocked", options);
            return; // on bloque la fermeture
        }
        this._cleanupWizardState();
        return super.close(options);
        }
    
    /**
     * Nettoie l'état interne du wizard (listeners, pending, caches) pour éviter toute pollution
     * si le wizard est annulé/fermé puis relancé.
     */
    _cleanupWizardState() {
        try {
            // Pending / caches wizard
            this._copsTrainingPending = null;
            this._copsTrainingHistoryNames = null;
            this._copsPendingSpecsEdu = null;
            this._copsBoundFlow = null;

            // Observers/listeners
            try { this._copsResizeObserver?.disconnect?.(); } catch (e) {}
            this._copsResizeObserver = null;

            // Reset step/navigation flags
            this._copsStep = 0;
            this._copsPreventCloseKeys = false;

            // Re-verrouille la fermeture par défaut (utile si réouverture dans la même instance)
            this._copsAllowClose = false;
        } catch (e) {
            console.warn("COPS | wizard cleanup failed", e);
        }
    }


    /**
     * Finalisation : applique les choix du wizard sur l'acteur, crée skills + contacts,
     * puis ferme le wizard et ouvre la fiche PJ.
     */
    async _finishCreation() {
        const html = this.element;
        const actorId = this.options?.window?.actorId;
        const actor = actorId ? game.actors.get(actorId) : null;

        const Skills = game.cops?.chargen?.skills;
        const Contacts = game.cops?.chargen?.contacts;
        if (!actor || !Skills || !Contacts) {
            ui.notifications.error("Chargen: modules skills/contacts non chargés (ou acteur introuvable).");
            return;
        }

        // 1) Validations finales
        const budget = parseInt(html.querySelector("#budget-display")?.textContent ?? "0");
        if (budget < 0) return ui.notifications.error("Budget Compétences dépassé !");

        const caracUsed = parseInt(html.querySelector("#carac-points")?.dataset?.used ?? "0");
        if (caracUsed !== 21) return ui.notifications.error("Caractéristiques : Vous devez dépenser exactement 21 points.");

        // 2) Caracs
        const caracUpdates = {};
        CARACS_LIST.forEach(key => {
            const v = parseInt(html.querySelector(`#stat-${key}`)?.textContent ?? "2");
            caracUpdates[`system.caracteristiques.${key}.value`] = v;
        });

        // 3) Skills map
        const skillMap = new Map();

        // Base
        // NOTE: à l'étape 4, les lignes Base reflètent déjà un snapshot "post-Historique" (pré-Training)
        // pour les compétences du kit de base. On retient la liste pour éviter de ré-appliquer
        // l'Éducation (Étape 3) une 2e fois lors de la finalisation.
        const baseSnapshotNames = new Set();
        const preTrainingSnapshotNames = new Set();
        html.querySelectorAll(".base-skill-row").forEach(row => {
            const name = row.dataset.name;
            baseSnapshotNames.add(name);
            preTrainingSnapshotNames.add(name);
            // Le niveau affiché peut être "bloqué" au palier+1 (UX). On garde un niveau réel séparé.
            const level = parseInt(row.dataset.baseLevelAfterTraining ?? row.dataset.baseLevelActual ?? row.querySelector(".skill-level")?.textContent ?? "10");
            const template = STARTER_SKILLS.find(s => s.name === name);
            // La spé principale peut venir du snapshot post-Historique (ex: Arme de contact via Éducation)
            const snapSpec = String(row.dataset.specPrimary ?? row.dataset.spec ?? "").trim();
            skillMap.set(name, {
                level,
                carac: template?.carac ?? "reflexes",
                spec: snapSpec || (template?.spec || "")
            });

            // Training (Étape 4) : améliorations sur Base via -1/-2
            // - Général: déjà inclus via baseLevelAfterTraining si présent
            // - Spécialisations: stockées sur la row (trainingDimSpec / trainingDimSpecBoost / trainingDimSpecCreate)
            
const tSpec = String(row.dataset.trainingDimSpec ?? "").trim();
const tBoost = Number(row.dataset.trainingDimSpecBoost ?? 0);
const tCreate = String(row.dataset.trainingDimSpecCreate ?? "0") === "1";

if (tSpec && (tCreate || tBoost)) {
    const entry = skillMap.get(name);
    entry._trainingSpecCreates ??= new Set();
    entry._trainingSpecBoosts  ??= {};
    if (tCreate) entry._trainingSpecCreates.add(tSpec);
    if (tBoost) if (tBoost) entry._trainingSpecBoosts[tSpec] = (entry._trainingSpecBoosts[tSpec] ?? 0) + tBoost;
}
});

        // Compétences hors kit acquises via Historique (affichées en colonne Achat, mais diminuables)
        html.querySelectorAll(".history-skill-row").forEach(row => {
            const name = row.dataset.name;
            if (!name) return;
            preTrainingSnapshotNames.add(name);

            const level = parseInt(row.dataset.baseLevelAfterTraining ?? row.dataset.baseLevelActual ?? row.querySelector(".skill-level")?.textContent ?? "10");
            const snapSpec = String(row.dataset.specPrimary ?? row.dataset.spec ?? "").trim();
            // carac : par défaut (la config Skills reste la source de vérité)
            if (!skillMap.has(name)) {
                skillMap.set(name, { level, carac: "reflexes", spec: snapSpec || "" });
            } else {
                // si déjà existante (cas rare), on force le niveau du snapshot
                const entry = skillMap.get(name);
                entry.level = level;
                if (snapSpec && !String(entry.spec ?? "").trim()) entry.spec = snapSpec;
            }

            // Training (Étape 4) : diminutions spécialisées sur ces skills (même stockage que Base)
            const tSpec = String(row.dataset.trainingDimSpec ?? "").trim();
            const tBoost = Number(row.dataset.trainingDimSpecBoost ?? 0);
            const tCreate = String(row.dataset.trainingDimSpecCreate ?? "0") === "1";
            if (tSpec && (tCreate || tBoost)) {
                const entry = skillMap.get(name);
                entry._trainingSpecCreates ??= new Set();
                entry._trainingSpecBoosts  ??= {};
                if (tCreate) entry._trainingSpecCreates.add(tSpec);
                if (tBoost) entry._trainingSpecBoosts[tSpec] = (entry._trainingSpecBoosts[tSpec] ?? 0) + tBoost;
            }
        });

        // Profil : CàC + Social
        const cacSpec = html.querySelector("input[name='cacSpec']:checked")?.value ?? "Coups";
        skillMap.set("Corps à corps", { level: 7, carac: "reflexes", spec: cacSpec });

        const socialName = html.querySelector("input[name='socialSkill']:checked")?.value ?? "Éloquence";
        let socialCarac = "charme";
        if (socialName === "Intimidation") socialCarac = "sangFroid";
        else if (socialName === "Rhétorique") socialCarac = "education";
        skillMap.set(socialName, { level: 7, carac: socialCarac, spec: "" });

      // Éducation bonus (2 sélections)
        const edu1 = html.querySelector("#edu-bonus-1")?.value;
        const edu2 = html.querySelector("#edu-bonus-2")?.value;

        const edu1Spec = this._copsPendingSpecsEdu?.edu1 ?? "";
        const edu2Spec = this._copsPendingSpecsEdu?.edu2 ?? "";
        const armeSpec = this._copsPendingSpecsEdu?.arme ?? "";
        const connaissanceSpec1 = this._copsPendingSpecsEdu?.connaissance1 ?? "";
        const connaissanceMode2 = this._copsPendingSpecsEdu?.connaissance2Mode ?? "existing";
        const connaissanceSpec2 = this._copsPendingSpecsEdu?.connaissance2 ?? "";


        const applyEduBonus = (name, pendingSpec) => {
        if (!name) return;

        // ✅ IMPORTANT : si la compétence est déjà dans la colonne Base (snapshot post-Historique),
        // alors l'Éducation a déjà été intégrée dans le niveau affiché/stocké. On ne la ré-applique pas.
        if (preTrainingSnapshotNames.has(name) && skillMap.has(name)) {
            // Exception : certaines compétences hors-kit peuvent être absentes des lignes Base.
            // Ici on skip uniquement si elle fait partie du snapshot Base.
            return;
        }

        // ✅ IMPORTANT : Conduite / Corps à corps = déjà spécialisées => ne pas toucher au "niveau" ici
        if (name === "Conduite" || name === "Corps à corps" || name === "Connaissance") return;


        if (skillMap.has(name)) skillMap.get(name).level -= 1;
        else skillMap.set(name, { level: 9, carac: "reflexes", spec: "" });

        // On stocke la spé “en attente” mais on ne l’applique PAS tout de suite
        // (on ne l'appliquera que si le niveau descend au palier requis)
        const entry = skillMap.get(name);
        if (name === "Informatique" && pendingSpec) entry._pendingSpec = pendingSpec;
        if (name === "Arme de contact" && pendingSpec) entry._pendingSpec = pendingSpec;
        if (name === "Connaissance" && pendingSpec) entry.spec = pendingSpec; // 9+ => direct

        };

        applyEduBonus(edu1,
        (edu1 === "Informatique") ? edu1Spec :
        (edu1 === "Arme de contact") ? armeSpec :
        (edu1 === "Connaissance") ? connaissanceSpec1 :
        ""
        );

        applyEduBonus(edu2,
        (edu2 === "Informatique") ? edu2Spec :
        (edu2 === "Arme de contact") ? armeSpec :
        (edu2 === "Connaissance")
            ? ((edu1 === "Connaissance" && connaissanceMode2 === "new") ? connaissanceSpec2 : connaissanceSpec1)
            : ""
        );
        
        // ✅ Application Éducation : Connaissance (9+) en "free text" (peut être prise 2 fois)
        {
        const b1 = String(html.querySelector("#edu-bonus-1")?.value ?? "");
        const b2 = String(html.querySelector("#edu-bonus-2")?.value ?? "");

        if (b1 === "Connaissance" || b2 === "Connaissance") {
            // Assure l'entrée skillMap (Connaissance démarre à 9)
            if (!skillMap.has("Connaissance")) {
            skillMap.set("Connaissance", { level: 9, carac: "reflexes", spec: "" });
            }
            const entry = skillMap.get("Connaissance");

            const spec1 = String(this._copsPendingSpecsEdu?.connaissance1 ?? "").trim();
            const mode2 = String(this._copsPendingSpecsEdu?.connaissance2Mode ?? "existing"); // existing | new
            const spec2 = String(this._copsPendingSpecsEdu?.connaissance2 ?? "").trim();

            // 1ère spé => utilisée pour la création "principale" via Skills.setSkillCreationLevel (specKey)
            if (spec1) entry.spec = spec1;

            // Prépare des instructions post-création sur system.specialisations (comme Conduite/CàC)
            entry._eduKnowCreates ??= new Set();
            entry._eduKnowBoosts  ??= {};

            // Si Connaissance est prise 2 fois :
            if (b1 === "Connaissance" && b2 === "Connaissance") {
            if (mode2 === "new") {
                // 2e spé distincte => doit exister à 9 aussi
                if (spec2 && spec2.toLowerCase() !== spec1.toLowerCase()) entry._eduKnowCreates.add(spec2);
            } else {
                // améliore la spé existante (spec1) => -1
                if (spec1) entry._eduKnowBoosts[spec1] = (entry._eduKnowBoosts[spec1] ?? 0) + 1;
            }
            }
        }
        }


        // ✅ Application Éducation : compétences déjà spécialisées (Conduite / Corps à corps)
        // Rappel : pas d'amélioration du "général", seulement une spé existante OU une nouvelle spé.
        {
        const applyAlreadySpecEdu = (slot /*"b1"|"b2"*/, skillName) => {
            if (skillName !== "Conduite" && skillName !== "Corps à corps") return;

            const st = this._copsPendingSpecsEdu?.alreadySpec?.[slot];
            if (!st) return;

            const chosenSpec = String(st.spec ?? "").trim();
            if (!chosenSpec) return; // normalement validé étape 3

            // La compétence existe déjà dans skillMap (starter / profil)
            if (!skillMap.has(skillName)) return;

            const entry = skillMap.get(skillName);

            entry._eduSpecCreates ??= new Set();  // specs "new" => créées à 8
            entry._eduSpecBoosts  ??= {};         // specs "existing" => -1 par bonus

            if (st.mode === "new") {
            entry._eduSpecCreates.add(chosenSpec);
            } else {
            entry._eduSpecBoosts[chosenSpec] = (entry._eduSpecBoosts[chosenSpec] ?? 0) + 1;
            }


        };

        const edu1Name = String(html.querySelector("#edu-bonus-1")?.value ?? "");
        const edu2Name = String(html.querySelector("#edu-bonus-2")?.value ?? "");

        applyAlreadySpecEdu("b1", edu1Name);
        applyAlreadySpecEdu("b2", edu2Name);
        }





        // Achats (drag & drop)
html.querySelectorAll(".bought-skill-row").forEach(row => {
    const name = row.dataset.name;
    const cost = parseInt(row.dataset.cost ?? "0");
    const pickedSpec = String(row.dataset.spec ?? "").trim();

    if (skillMap.has(name)) {
        const entry = skillMap.get(name);
        entry.level -= cost;
        // Si un choix de spé a été fait côté Training, on le garde (si pas déjà renseigné)
        if (pickedSpec && !String(entry.spec ?? "").trim()) entry.spec = pickedSpec;
    } else {
        skillMap.set(name, { level: (cost === 1) ? 9 : 8, carac: "reflexes", spec: pickedSpec || "" });
    }
});

// 4) Contacts (Moteur A : create OU upgrade via dropdown)

                const dupCheck = () => {
                const seen = new Map();
                const add = (label, value) => {
                    const v = String(value ?? "").trim();
                    if (!v) return null;
                    const k = v.toLowerCase();
                    if (seen.has(k)) return `${label} utilise le même nom que ${seen.get(k)} : "${v}"`;
                    seen.set(k, label);
                    return null;
                };

                const errors = [];

                // Origine (create, même si optionnel)
                errors.push(add("Origine", html.querySelector("#contact-origine-nom")?.value));

                // Éducation : seulement si mode=create
                const em = html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create";
                if (em === "create") errors.push(add("Éducation", html.querySelector("#contact-educ-nom")?.value));

                // Entrée 1 : seulement si mode=create
                const m1 = html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create";
                if (m1 === "create") errors.push(add("Entrée COPS 1", html.querySelector("#contact-entree1-nom")?.value));

                // Entrée 2 : seulement si mode=create
                const m2 = html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create";
                if (m2 === "create") errors.push(add("Entrée COPS 2", html.querySelector("#contact-entree2-nom")?.value));

                const msg = errors.filter(Boolean)[0];
                if (msg) {
                    ui.notifications.error(
                    "Contacts : doublon détecté.\n" + msg + "\n→ Choisis “Améliorer” ou change le nom."
                    );
                    return false;
                }
                return true;
                };

                if (!dupCheck()) return;


            const contactMap = new Map();
                const norm = (s) => String(s ?? "").trim().toLowerCase();

                // retourne le type actuel d'un contact EXISTANT sur l'acteur (utile en mode upgrade)
                const getExistingContactType = (contactName) => {
                const n = norm(contactName);
                const it = actor.items.find(i => i.type === "contact" && norm(i.name) === n);
                return String(it?.system?.type ?? "informateur").toLowerCase() === "allie" ? "allie" : "informateur";
                };

                // typeOpt : "allie" | "informateur" | null
                // - create => on passe un type ("allie"/"informateur")
                // - upgrade => on passe null, et on conserve le type existant
                const addOrBoost = (name, dom, boost, typeOpt = null) => {
                const n = String(name ?? "").trim();
                if (!n) return;

                const key = norm(n);

                if (contactMap.has(key)) {
                    const entry = contactMap.get(key);
                    entry.level += boost;

                    // si on reçoit un type (create), on le garde, sinon on conserve celui déjà stocké
                    if (typeOpt) entry.type = (String(typeOpt).toLowerCase() === "allie") ? "allie" : "informateur";

                    // domaine: si vide et qu'on en reçoit un, on remplit
                    const d = String(dom ?? "").trim();
                    if (!entry.domaine && d) entry.domaine = d;

                } else {
                    const d = String(dom ?? "").trim();

                    // si upgrade => typeOpt null => on lit le type existant sur l'acteur
                    const t = typeOpt
                    ? ((String(typeOpt).toLowerCase() === "allie") ? "allie" : "informateur")
                    : getExistingContactType(n);

                    contactMap.set(key, { name: n, type: t, domaine: d, level: boost });
                }
            };


            // helper: bloque si "create" utilise un nom déjà existant
            const existingNames = (actor.items ?? [])
            .filter(i => ["contact","contacts"].includes(i.type))
            .map(i => String(i.name ?? "").trim().toLowerCase());

            const assertNewName = (label, name) => {
            const n = String(name ?? "").trim().toLowerCase();
            if (!n) return true;
            if (existingNames.includes(n)) {
                ui.notifications.error(`${label} : ce contact existe déjà. Choisis “Améliorer” ou change le nom.`);
                return false;
            }
            return true;
            };

            // Origine : toujours "create" (niveau 2)
            {
            const nm = html.querySelector("#contact-origine-nom")?.value;
            const dom = html.querySelector("#contact-origine-dom")?.value;
            const type = html.querySelector("#contact-origine-type")?.value ?? "informateur";
            addOrBoost(nm, dom, 2, type);
            }


            // Éducation : create OU upgrade (+1)
            {
            const mode = html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create";
            if (mode === "upgrade") {
                const pick = html.querySelector("#contact-educ-existing")?.value;
                if (!pick) return ui.notifications.error("Éducation : choisis un contact à améliorer.");
                addOrBoost(pick, "", 1, null);
            } else {
                const nm = html.querySelector("#contact-educ-nom")?.value;
                const dom = html.querySelector("#contact-educ-dom")?.value;
                if (!nm?.trim()) return ui.notifications.error("Éducation : nom obligatoire.");
                if (!assertNewName("Éducation", nm)) return;
                const type = html.querySelector("#contact-educ-type")?.value ?? "informateur";
                addOrBoost(nm, dom, 1, type);

            }
            }

            // Entrée 1 : create OU upgrade (+1)
            {
            const mode = html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create";
            if (mode === "upgrade") {
                const pick = html.querySelector("#contact-entree1-existing")?.value;
                if (!pick) return ui.notifications.error("Entrée au C.O.P.S (1) : choisis un contact à améliorer.");
                addOrBoost(pick, "", 1, null);
            } else {
                const nm = html.querySelector("#contact-entree1-nom")?.value;
                const dom = html.querySelector("#contact-entree1-dom")?.value;
                if (!nm?.trim()) return ui.notifications.error("Entrée au C.O.P.S (1) : nom obligatoire.");
                if (!assertNewName("Entrée au C.O.P.S (1)", nm)) return;
                const type = html.querySelector("#contact-entree1-type")?.value ?? "informateur";
                addOrBoost(nm, dom, 1, type);
            }
            }

            // Entrée 2 : create OU upgrade (+1)
            {
            const mode = html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create";
            if (mode === "upgrade") {
                const pick = html.querySelector("#contact-entree2-existing")?.value;
                if (!pick) return ui.notifications.error("Entrée au C.O.P.S (2) : choisis un contact à améliorer.");
                addOrBoost(pick, "", 1, null);
            } else {
                const nm = html.querySelector("#contact-entree2-nom")?.value;
                const dom = html.querySelector("#contact-entree2-dom")?.value;
                if (!nm?.trim()) return ui.notifications.error("Entrée au C.O.P.S (2) : nom obligatoire.");
                if (!assertNewName("Entrée au C.O.P.S (2)", nm)) return;
                const type = html.querySelector("#contact-entree2-type")?.value ?? "informateur";
                addOrBoost(nm, dom, 1, type);
            }
            }

            // Free #1 : create OU upgrade (+1)
            {
            const mode = html.querySelector(`input[name="free1ContactMode"]:checked`)?.value ?? "create";
            if (mode === "upgrade") {
                const pick = html.querySelector("#contact-free1-existing")?.value;
                if (!pick) return ui.notifications.error("Contact libre (1) : choisis un contact à améliorer.");
                addOrBoost(pick, "", 1, null); // upgrade => conserve le type existant
            } else {
                const nm = html.querySelector("#contact-free1-nom")?.value;
                const dom = html.querySelector("#contact-free1-dom")?.value;
                if (!nm?.trim()) return ui.notifications.error("Contact libre (1) : nom obligatoire.");
                if (!assertNewName("Contact libre (1)", nm)) return;
                const type = html.querySelector("#contact-free1-type")?.value ?? "informateur";
                addOrBoost(nm, dom, 1, type);  // create => applique le type choisi
            }
            }

            // Free #2 : create OU upgrade (+1)
            {
            const mode = html.querySelector(`input[name="free2ContactMode"]:checked`)?.value ?? "create";
            if (mode === "upgrade") {
                const pick = html.querySelector("#contact-free2-existing")?.value;
                if (!pick) return ui.notifications.error("Contact libre (2) : choisis un contact à améliorer.");
                addOrBoost(pick, "", 1, null); // upgrade => conserve le type existant
            } else {
                const nm = html.querySelector("#contact-free2-nom")?.value;
                const dom = html.querySelector("#contact-free2-dom")?.value;
                if (!nm?.trim()) return ui.notifications.error("Contact libre (2) : nom obligatoire.");
                if (!assertNewName("Contact libre (2)", nm)) return;
                const type = html.querySelector("#contact-free2-type")?.value ?? "informateur";
                addOrBoost(nm, dom, 1, type);  // create => applique le type choisi
            }
            }

            // Applique les specs "en attente" uniquement si on atteint le palier (ex: Informatique palier 5)
            for (const [name, data] of skillMap) {
            if (data.spec) continue;
            const pending = data._pendingSpec;
            if (!pending) continue;

            const cfg = await Skills.getSkillConfig(name);
            const lvl = Number(data.level);

            if (cfg.specialisationAt > 0 && cfg.specialisationAt < 9 && lvl <= cfg.specialisationAt) {
                data.spec = String(pending);
            }
            }


        // 5) Prévalidation spé (en une seule passe)
        const missingSpecs = [];
        for (const [name, data] of skillMap) {
            const cfg = await Skills.getSkillConfig(name);
            const lvl = Number(data.level);
            const spec = String(data.spec ?? "").trim();

            if (cfg.specialisationAt >= 9 && !spec) {
                missingSpecs.push(`${name} : spécialisation obligatoire (9+)`);
                continue;
            }
            if (cfg.specialisationAt > 0 && cfg.specialisationAt < 9 && lvl <= cfg.specialisationAt && !spec) {
                missingSpecs.push(`${name} : choisir une spécialisation (palier ${cfg.specialisationAt})`);
            }
        }
        if (missingSpecs.length) {
            ui.notifications.error("Spécialisations manquantes:\n- " + missingSpecs.join("\n- "));
            return;
        }

        // 6) Updates identité + ressources
        const anc = parseInt(html.querySelector("#res-anc")?.dataset?.value ?? "1");
        const adr = parseInt(html.querySelector("#res-adr")?.dataset?.value ?? "1");

        const finalUpdates = {
            ...caracUpdates,
            "system.identite.origineSociale": html.querySelector("#sel-origine option:checked")?.text ?? "",
            "system.identite.education": html.querySelector("#sel-educ option:checked")?.text ?? "",
            "system.identite.entreeCops": html.querySelector("#sel-entree option:checked")?.text ?? "",
            "system.ressources.anciennete": anc,
            "flags.cops.maxAnciennete": anc,
            "system.ressources.adrenaline.value": adr,
            "system.ressources.adrenaline.max": adr
        };

        await actor.update(finalUpdates);

        // 7) Création skills (chargen => pas d'XP)
        const createOptions = { fromChargen: true };
        for (const [name, data] of skillMap) {
            await Skills.setSkillCreationLevel(actor, name, data.level, {
                specKey: (() => {
                const s = String(data.spec ?? "").trim();
                return s ? s : null;
                })(),

                createOptions
            });
        }

       // ✅ Applique les créations/améliorations de spécialisations pour Conduite / Corps à corps (Historique)
                    for (const [name, data] of skillMap) {
                    const creates = data._eduSpecCreates;
                    const boosts  = data._eduSpecBoosts;

                    if ((!creates || creates.size === 0) && (!boosts || Object.keys(boosts).length === 0)) continue;

                    const item = actor.items.find(i => (i.type === "competence" || i.type === "skill") && i.name === name);
                    if (!item) continue;

                const sys = item.system ?? {};
            const specialisations = foundry.utils.duplicate(sys.specialisations ?? {});

            // ✅ valeur de départ d’une nouvelle spé = palier de spécialisation
            // - Conduite : palier 8 => nouvelle spé à 8
            // - Corps à corps : palier 7 => nouvelle spé à 7
            const cfg = await Skills.getSkillConfig(name);
            const baseNewSpec = (cfg?.specialisationAt > 0 && cfg.specialisationAt < 9) ? Number(cfg.specialisationAt) : 8;

            // 1) "new" => créer à baseNewSpec (sans amélioration)
            if (creates && creates.size) {
            for (const specName of creates) {
                const s = String(specName ?? "").trim();
                if (!s) continue;
                if (specialisations[s] == null) specialisations[s] = baseNewSpec;
            }
            }

            // 2) "existing" => -1 par bonus
            if (boosts) {
            for (const [specName, count] of Object.entries(boosts)) {
                const s = String(specName ?? "").trim();
                const c = Number(count ?? 0);
                if (!s || !c) continue;

                const cur = Number(specialisations[s] ?? baseNewSpec);
                specialisations[s] = cur - c;
            }
            }


        await item.update({ "system.specialisations": specialisations });
        }


            // ✅ Applique les créations/améliorations de spécialisations pour Training (Étape 4 : -1/-2 sur Base)
            {
                for (const [name, data] of skillMap) {
                    const creates = data._trainingSpecCreates;
                    const boosts  = data._trainingSpecBoosts;

                    if ((!creates || creates.size === 0) && (!boosts || Object.keys(boosts).length === 0)) continue;

                    const item = actor.items.find(i => (i.type === "competence" || i.type === "skill") && i.name === name);
                    if (!item) continue;

                    const sys = item.system ?? {};
                    const specialisations = foundry.utils.duplicate(sys.specialisations ?? {});

					const cfg = await Skills.getSkillConfig(name);
					const at = Number(cfg?.specialisationAt ?? 0);
					// Valeur de départ d'une nouvelle spécialisation = palier.
					// Cas particulier : Connaissance (palier 9+) => baseNewSpec doit être 9 (et jamais 8).
					const baseNewSpec = (at > 0) ? at : 8;
					const norm = (x) => String(x ?? "").trim().toLowerCase();
                    const minLevel = 5;

					// new => créer à baseNewSpec
                    if (creates && creates.size) {
                        for (const specName of creates) {
                            const s = String(specName ?? "").trim();
                            if (!s) continue;
							// évite les collisions de casse/espaces (ex: "Test" vs "test ")
							const existingKey = Object.keys(specialisations).find(k => norm(k) === norm(s));
							if (existingKey == null && specialisations[s] == null) specialisations[s] = baseNewSpec;
                        }
                    }

					// boosts => -count (amélioration)
                    if (boosts) {
                        for (const [specName, count] of Object.entries(boosts)) {
                            const s = String(specName ?? "").trim();
                            const c = Number(count ?? 0);
                            if (!s || !c) continue;
							// Match clé existante de manière robuste (case-insensitive + trim)
							const existingKey = Object.keys(specialisations).find(k => norm(k) === norm(s));
							const key = existingKey ?? s;
							const cur = Number(specialisations[key] ?? baseNewSpec);
							specialisations[key] = Math.max(minLevel, cur - c);
                        }
                    }

                    await item.update({ "system.specialisations": specialisations });
                }
            }

            // ✅ Applique les créations/améliorations de spécialisations pour Connaissance (Historique)
            {
            const data = skillMap.get("Connaissance");
            const creates = data?._eduKnowCreates;
            const boosts  = data?._eduKnowBoosts;

            if (data && ((creates && creates.size) || (boosts && Object.keys(boosts).length))) {
                const item = actor.items.find(i => (i.type === "competence" || i.type === "skill") && i.name === "Connaissance");
                if (item) {
                const sys = item.system ?? {};
                const specialisations = foundry.utils.duplicate(sys.specialisations ?? {});

                const baseNewSpec = 9; // Connaissance = 9+

                // new => créer à 9
                if (creates && creates.size) {
                    for (const specName of creates) {
                    const s = String(specName ?? "").trim();
                    if (!s) continue;
                    if (specialisations[s] == null) specialisations[s] = baseNewSpec;
                    }
                }

                // existing => -1 par bonus
                if (boosts) {
                    for (const [specName, count] of Object.entries(boosts)) {
                    const s = String(specName ?? "").trim();
                    const c = Number(count ?? 0);
                    if (!s || !c) continue;
                    const cur = Number(specialisations[s] ?? baseNewSpec);
                    specialisations[s] = cur - c;
                    }
                }

                await item.update({ "system.specialisations": specialisations });
                }
            }
            }


        // 8) Création contacts
        for (const c of contactMap.values()) {
            await Contacts.createOrBoostContact(actor, {
                name: c.name,
                type: (String(c.type ?? "informateur").toLowerCase() === "allie") ? "allie" : "informateur",
                domaine: c.domaine,
                niveau: c.level
            }, 0);
        }

        // 9) PV au max
        const newCarrure = caracUpdates["system.caracteristiques.carrure.value"] || 2;
        const newMaxPV = 20 + (newCarrure * 3);
        await actor.update({ "system.ressources.pv.value": newMaxPV });

        ui.notifications.info("Personnage créé avec succès !");
        this._copsAllowClose = true;
        this._creationCompleted = true;
        await this.close();

        try { actor.sheet?.render?.(true); } catch (e) {}
    }



    async _onRender(context, options) {
        await super._onRender(context, options);
        const html = this.element;



        html.classList.add("cops-wizard-app");


        // ===== KILL FOOTER NATIF (DialogV2 noop) : fiabilisé =====
            try {
            const root = this.element; // <dialog>
            if (root) {
                // bouton "noop" selon différentes variantes Foundry
                const noopBtn =
                root.querySelector('button[data-action="noop"]') ||
                root.querySelector('button[name="noop"]') ||
                root.querySelector('button[data-button="noop"]');

                if (noopBtn) {
                // cache le bouton
                noopBtn.style.display = "none";

                // si son footer parent ne contient plus rien d'utile, on cache le footer
                const nativeFooter = noopBtn.closest("footer");
                if (nativeFooter) nativeFooter.style.display = "none";
                }

                // au cas où Foundry render un footer natif même sans trouver le bouton
                const likelyNativeFooters = root.querySelectorAll("footer.dialog-buttons, footer.window-footer, form > footer");
                for (const f of likelyNativeFooters) {
                // si ce footer contient un bouton noop (même sans label), on le masque
                const hasNoop =
                    f.querySelector('button[data-action="noop"]') ||
                    f.querySelector('button[name="noop"]') ||
                    f.querySelector('button[data-button="noop"]');
                if (hasNoop) f.style.display = "none";
                }
            }
            } catch (e) {
            console.warn("COPS | failed to hide native DialogV2 footer", e);
            }


     // === SCROLL FIX (footer toujours visible) ===
            const root = this.element; // <dialog>
            const wc = root?.querySelector("section.window-content");
            const wiz = root?.querySelector(".cops-wizard");
            const content = root?.querySelector(".cops-wizard > section.content");
            const footer = root?.querySelector(".cops-wizard > footer.cops-wizard-footer");

            if (wc && wiz && content && footer) {
            // le conteneur Foundry devient la colonne principale
            wc.style.display = "flex";
            wc.style.flexDirection = "column";
            wc.style.height = "100%";
            wc.style.minHeight = "0";

            // ✅ IMPORTANT : c'est window-content qui scrolle si besoin
            wc.style.overflowY = "auto";

            // wizard en colonne
            wiz.style.display = "flex";
            wiz.style.flexDirection = "column";
            wiz.style.minHeight = "0";
            wiz.style.flex = "1 1 auto";

            // contenu prend l'espace dispo (mais pas le scroll principal)
            content.style.flex = "1 1 auto";
            content.style.minHeight = "0";
            content.style.overflow = "visible";

            // footer toujours visible
            footer.style.position = "sticky";
            footer.style.bottom = "0";
            footer.style.zIndex = "10";
            }
            

        // --- Anti-fermeture auto (Enter/Escape) ---
        if (!this._copsPreventCloseKeys) {
        this._copsPreventCloseKeys = true;

        // Empêche Enter de "submit" le dialog
        html.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            }
            // Empêche Escape de fermer
            if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            }
        }, true);
        }


        // 1. WIZARD FLOW (sans onglets cliquables)
        const steps = ["caracs", "profil", "history", "training"];
        // Etat courant (persisté sur l'instance)
        if (this._copsStep == null) this._copsStep = 0;

        // Désactive les onglets cliquables (et on les masque : navigation uniquement via boutons)
        const nav = html.querySelector(".sheet-tabs");
        if (nav) nav.style.display = "none";

        const footerPrev = html.querySelector("[data-action='prevStep']");
        const footerNext = html.querySelector("[data-action='nextStep']");
        const footerFinish = html.querySelector("[data-action='finishWizard']");

        // Hook appelé à CHAQUE entrée sur l’étape Training (utile si on revient en arrière)
        let onEnterTraining = null;

        const showStep = (i) => {
            this._copsStep = Math.max(0, Math.min(steps.length - 1, Number(i)));
            const active = steps[this._copsStep];
            if (active === "training") onEnterTraining?.();
            html.querySelectorAll(".tab").forEach(p => {
                p.classList.toggle("active", p.dataset.tab === active);
                p.style.display = (p.dataset.tab === active) ? "block" : "none";
            });

            if (footerPrev) footerPrev.disabled = (this._copsStep === 0);
            if (footerNext) footerNext.style.display = (this._copsStep === steps.length - 1) ? "none" : "";
            if (footerFinish) footerFinish.style.display = (this._copsStep === steps.length - 1) ? "" : "none";
        };

        const resetTraining = () => {
            // Budget / achats
            const boughtList = html.querySelector("#bought-skills-list");
            if (boughtList) boughtList.innerHTML = "";
            const budgetDisplay = html.querySelector("#budget-display");
            if (budgetDisplay) budgetDisplay.textContent = "10";

            // Boutons diminution
            html.querySelectorAll(".base-skill-row .dim-btn").forEach(b => b.classList.remove("active"));
            html.querySelectorAll(".base-skill-row .skill-level").forEach(span => {
                const row = span.closest(".base-skill-row");
                if (!row) return;
                const baseLevel = Number(row.dataset.baseLevel ?? span.textContent);
                span.textContent = String(baseLevel);
                span.style.color = "#fff";
            });
        };

        const resetHistory = () => {
                        // On reset juste les champs “saisies” (pas les selects: on garde le choix si on revient)
                        ["#contact-origine-nom","#contact-origine-dom","#contact-educ-nom","#contact-educ-dom","#contact-entree1-nom","#contact-entree1-dom","#contact-entree2-nom","#contact-entree2-dom"]
                        .forEach(sel => { const el = html.querySelector(sel); if (el) el.value = ""; });
                    };

                    const validateStep = () => {
                        // Validation "bloquante" avant de passer à l'étape suivante
                        const stepKey = steps[this._copsStep];

                        if (stepKey === "caracs") {
                            const used = Number(html.querySelector("#carac-points")?.dataset?.used ?? 0);
                            if (used !== 21) {
                                ui.notifications.error("Caractéristiques : Vous devez dépenser exactement 21 points.");
                                return false;
                            }
                            return true;
                        }

                        if (stepKey === "history") {
            const missing = [];

            // Éducation
            const educMode = html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create";
            if (educMode === "create") {
                const educName = String(html.querySelector("#contact-educ-nom")?.value ?? "").trim();
                if (!educName) missing.push("Contact (Éducation)");
            } else {
                const educPick = String(html.querySelector("#contact-educ-existing")?.value ?? "").trim();
                if (!educPick) missing.push("Contact (Éducation) : choisir un contact à améliorer");
            }

            // Entrée 1
            const e1Mode = html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create";
            if (e1Mode === "create") {
                const v = String(html.querySelector("#contact-entree1-nom")?.value ?? "").trim();
                if (!v) missing.push("Contact (Entrée au C.O.P.S) 1");
            } else {
                const v = String(html.querySelector("#contact-entree1-existing")?.value ?? "").trim();
                if (!v) missing.push("Contact (Entrée au C.O.P.S) 1 : choisir un contact à améliorer");
            }

            // Entrée 2
            const e2Mode = html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create";
            if (e2Mode === "create") {
                const v = String(html.querySelector("#contact-entree2-nom")?.value ?? "").trim();
                if (!v) missing.push("Contact (Entrée au C.O.P.S) 2");
            } else {
                const v = String(html.querySelector("#contact-entree2-existing")?.value ?? "").trim();
                if (!v) missing.push("Contact (Entrée au C.O.P.S) 2 : choisir un contact à améliorer");
            }


            if (missing.length) {
                ui.notifications.error("Contacts :\n- " + missing.join("\n- "));
                return false;
            }
           
                // Anti-doublons (uniquement create-mode)
                const norm = (s) => String(s ?? "").trim().toLowerCase();
                const seen = new Map();
                const check = (label, value) => {
                const v = String(value ?? "").trim();
                if (!v) return null;
                const k = norm(v);
                if (seen.has(k)) return `${label} duplique ${seen.get(k)} : "${v}"`;
                seen.set(k, label);
                return null;
                };

                const errs = [];

                // Origine (create)
                errs.push(check("Origine", html.querySelector("#contact-origine-nom")?.value));

                // Éducation (create uniquement)
                if ((html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create") === "create")
                errs.push(check("Éducation", html.querySelector("#contact-educ-nom")?.value));

                // Entrée 1 (create uniquement)
                if ((html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create") === "create")
                errs.push(check("Entrée COPS 1", html.querySelector("#contact-entree1-nom")?.value));

                // Entrée 2 (create uniquement)
                if ((html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create") === "create")
                errs.push(check("Entrée COPS 2", html.querySelector("#contact-entree2-nom")?.value));

                // Contacts libres (create uniquement)
                if ((html.querySelector(`input[name="free1ContactMode"]:checked`)?.value ?? "create") === "create")
                errs.push(check("Contact libre (1)", html.querySelector("#contact-free1-nom")?.value));

                if ((html.querySelector(`input[name="free2ContactMode"]:checked`)?.value ?? "create") === "create")
                errs.push(check("Contact libre (2)", html.querySelector("#contact-free2-nom")?.value));

                const msg = errs.filter(Boolean)[0];
                if (msg) {
                ui.notifications.error("Contacts : doublon détecté.\n" + msg + "\n→ change le nom ou passe en “Améliorer”.");
                return false;
                }

                // ✅ Validation Contacts libres (nom obligatoire / upgrade max 4)
                {
                const actorId = this.options?.window?.actorId;
                const actor = actorId ? game.actors.get(actorId) : null;
                const Contacts = game.cops?.chargen?.contacts;

                const getLvl = (contactKey) => {
                    if (!actor || !Contacts) return null;
                    const key = String(contactKey ?? "").trim();
                    if (!key) return null;

                    // 1) Si la valeur est un id d'item contact (select value), on lit directement l'item.
                    const byId = actor.items?.get?.(key);
                    if (byId && byId.type === "contact") return Number(byId.system?.niveau ?? 1);

                    // 2) Sinon on essaie par nom (case-insensitive).
                    const list = Contacts.getContacts(actor);
                    const found = list.find(c => String(c.name).localeCompare(key, undefined, { sensitivity: "base" }) === 0);
                    return found ? Number(found.niveau ?? 1) : null;
                };

                // Free #1
                const f1Mode = html.querySelector(`input[name="free1ContactMode"]:checked`)?.value ?? "create";
                if (f1Mode === "upgrade") {
                    const pick = html.querySelector("#contact-free1-existing")?.value;
                    if (!pick) { ui.notifications.error("Contact libre (1) : choisis un contact à améliorer."); return false; }
                    const lvl = getLvl(pick);
                    if (lvl != null && lvl >= 4) { ui.notifications.error("Contact libre (1) : ce contact est déjà niveau 4."); return false; }
                } else {
                    const nm = String(html.querySelector("#contact-free1-nom")?.value ?? "").trim();
                    if (!nm) { ui.notifications.error("Contact libre (1) : nom obligatoire."); return false; }
                    // Si le nom correspond à un contact existant, on force le mode Upgrade
                    const existingLvl = getLvl(nm);
                    if (existingLvl != null) {
                        ui.notifications.error("Contact libre (1) : ce contact existe déjà. Passe en \"Améliorer\" pour lui ajouter +1 (max 4).");
                        return false;
                    }
                }

                // Free #2
                const f2Mode = html.querySelector(`input[name="free2ContactMode"]:checked`)?.value ?? "create";
                if (f2Mode === "upgrade") {
                    const pick = html.querySelector("#contact-free2-existing")?.value;
                    if (!pick) { ui.notifications.error("Contact libre (2) : choisis un contact à améliorer."); return false; }
                    const lvl = getLvl(pick);
                    if (lvl != null && lvl >= 4) { ui.notifications.error("Contact libre (2) : ce contact est déjà niveau 4."); return false; }
                } else {
                    const nm = String(html.querySelector("#contact-free2-nom")?.value ?? "").trim();
                    if (!nm) { ui.notifications.error("Contact libre (2) : nom obligatoire."); return false; }
                    const existingLvl = getLvl(nm);
                    if (existingLvl != null) {
                        ui.notifications.error("Contact libre (2) : ce contact existe déjà. Passe en \"Améliorer\" pour lui ajouter +1 (max 4).");
                        return false;
                    }
                }

                // ✅ Validation cumulée des upgrades (contacts existants)
                // Cas à couvrir : le même contact sélectionné plusieurs fois (Éducation/Entrée/Libres)
                // doit rester <= 4 après application de tous les +1.
                {
                    const planned = new Map(); // key(lower) -> { name, cnt }
                    const add = (name) => {
                        const nm = String(name ?? "").trim();
                        if (!nm) return;
                        const key = nm.toLowerCase();
                        const prev = planned.get(key);
                        planned.set(key, { name: nm, cnt: (prev?.cnt ?? 0) + 1 });
                    };

                    // Éducation (upgrade)
                    if ((html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create") === "upgrade") {
                        add(html.querySelector("#contact-educ-existing")?.value);
                    }
                    // Entrée 1 (upgrade)
                    if ((html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create") === "upgrade") {
                        add(html.querySelector("#contact-entree1-existing")?.value);
                    }
                    // Entrée 2 (upgrade)
                    if ((html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create") === "upgrade") {
                        add(html.querySelector("#contact-entree2-existing")?.value);
                    }
                    // Libres (upgrade)
                    if (f1Mode === "upgrade") add(html.querySelector("#contact-free1-existing")?.value);
                    if (f2Mode === "upgrade") add(html.querySelector("#contact-free2-existing")?.value);

                    for (const { name: nm, cnt } of planned.values()) {
                        const lvl = getLvl(nm);
                        if (lvl == null) continue;
                        if ((lvl + Number(cnt)) > 4) {
                            ui.notifications.error(`Contacts : "${nm}" dépasserait le niveau 4 (actuel ${lvl} + ${cnt}).`);
                            return false;
                        }
                    }
                }
                }

                // ✅ Validation niveau max 4 (inclut les contacts “draft” du wizard + points libres)
                // On reconstruit le contactMap EXACTEMENT comme dans _finishCreation(), puis on bloque si un contact dépasse 4.
                {
                    const contactMap = new Map();
                    const normC = (s) => String(s ?? "").trim().toLowerCase();

                    // type existant (si upgrade sur contact déjà sur l'acteur), sinon informateur par défaut
                    const getExistingContactType = (contactName) => {
                        const n = normC(contactName);
                        const it = actor?.items?.find?.(i => i.type === "contact" && normC(i.name) === n);
                        return String(it?.system?.type ?? "informateur").toLowerCase() === "allie" ? "allie" : "informateur";
                    };

                    const addOrBoost = (name, dom, boost, typeOpt = null) => {
                        const n = String(name ?? "").trim();
                        if (!n) return;
                        const key = normC(n);

                        if (contactMap.has(key)) {
                            const entry = contactMap.get(key);
                            entry.level += Number(boost ?? 0);

                            if (typeOpt) entry.type = (String(typeOpt).toLowerCase() === "allie") ? "allie" : "informateur";
                            const d = String(dom ?? "").trim();
                            if (!entry.domaine && d) entry.domaine = d;

                        } else {
                            const d = String(dom ?? "").trim();
                            const t = typeOpt
                                ? ((String(typeOpt).toLowerCase() === "allie") ? "allie" : "informateur")
                                : getExistingContactType(n);

                            contactMap.set(key, { name: n, type: t, domaine: d, level: Number(boost ?? 0) });
                        }
                    };

                    // Origine : create (niveau 2)
                    addOrBoost(html.querySelector("#contact-origine-nom")?.value,
                               html.querySelector("#contact-origine-dom")?.value,
                               2,
                               html.querySelector("#contact-origine-type")?.value ?? "informateur");

                    // Éducation : create (niveau 1) OU upgrade (+1)
                    {
                        const mode = html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create";
                        if (mode === "upgrade") {
                            addOrBoost(html.querySelector("#contact-educ-existing")?.value, "", 1, null);
                        } else {
                            addOrBoost(html.querySelector("#contact-educ-nom")?.value,
                                       html.querySelector("#contact-educ-dom")?.value,
                                       1,
                                       html.querySelector("#contact-educ-type")?.value ?? "informateur");
                        }
                    }

                    // Entrée 1 : create (niveau 1) OU upgrade (+1)
                    {
                        const mode = html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create";
                        if (mode === "upgrade") {
                            addOrBoost(html.querySelector("#contact-entree1-existing")?.value, "", 1, null);
                        } else {
                            addOrBoost(html.querySelector("#contact-entree1-nom")?.value,
                                       html.querySelector("#contact-entree1-dom")?.value,
                                       1,
                                       html.querySelector("#contact-entree1-type")?.value ?? "informateur");
                        }
                    }

                    // Entrée 2 : create (niveau 1) OU upgrade (+1)
                    {
                        const mode = html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create";
                        if (mode === "upgrade") {
                            addOrBoost(html.querySelector("#contact-entree2-existing")?.value, "", 1, null);
                        } else {
                            addOrBoost(html.querySelector("#contact-entree2-nom")?.value,
                                       html.querySelector("#contact-entree2-dom")?.value,
                                       1,
                                       html.querySelector("#contact-entree2-type")?.value ?? "informateur");
                        }
                    }

                    // Libres #1 : create (niveau 1) OU upgrade (+1)
                    {
                        const mode = html.querySelector(`input[name="free1ContactMode"]:checked`)?.value ?? "create";
                        if (mode === "upgrade") {
                            addOrBoost(html.querySelector("#contact-free1-existing")?.value, "", 1, null);
                        } else {
                            addOrBoost(html.querySelector("#contact-free1-nom")?.value,
                                       html.querySelector("#contact-free1-dom")?.value,
                                       1,
                                       html.querySelector("#contact-free1-type")?.value ?? "informateur");
                        }
                    }

                    // Libres #2 : create (niveau 1) OU upgrade (+1)
                    {
                        const mode = html.querySelector(`input[name="free2ContactMode"]:checked`)?.value ?? "create";
                        if (mode === "upgrade") {
                            addOrBoost(html.querySelector("#contact-free2-existing")?.value, "", 1, null);
                        } else {
                            addOrBoost(html.querySelector("#contact-free2-nom")?.value,
                                       html.querySelector("#contact-free2-dom")?.value,
                                       1,
                                       html.querySelector("#contact-free2-type")?.value ?? "informateur");
                        }
                    }

                    for (const c of contactMap.values()) {
                        if (Number(c.level ?? 0) > 4) {
                            ui.notifications.error(`Contacts : "${c.name}" dépasserait le niveau 4 (niveau ${c.level}).`);
                            return false;
                        }
                    }
                }

                // ✅ Prévalidation spé Informatique (palier 5) via Éducation :
                // si bonus1 ET bonus2 = Informatique => choix obligatoire avant de passer à l'étape suivante
                const b1 = String(html.querySelector("#edu-bonus-1")?.value ?? "");
                const b2 = String(html.querySelector("#edu-bonus-2")?.value ?? "");

                if (b1 === "Informatique" && b2 === "Informatique") {
                const pick = String(html.querySelector("#edu-bonus-1-spec")?.value ?? "").trim();
                if (!pick) {
                    ui.notifications.error("Historique : Informatique atteint le palier 5 → choisis une spécialisation.");
                    return false;
                }
                }

                // ✅ Prévalidation spé Arme de contact (palier 6) via Éducation :
                    if (b1 === "Arme de contact" && b2 === "Arme de contact") {
                   const pick = String(this._copsPendingSpecsEdu?.arme ?? "").trim();
                    if (!pick) {
                        ui.notifications.error(
                        "Historique : Arme de contact atteint le palier 6 → choisis une spécialisation."
                        );
                        return false;
                    }
                    }


                    // ✅ Prévalidation spé Connaissance (9+) via Éducation :
                    if (b1 === "Connaissance" || b2 === "Connaissance") {
                    const c1 = String(this._copsPendingSpecsEdu?.connaissance1 ?? "").trim()
                            || String(html.querySelector("#edu-connaissance-spec-1")?.value ?? "").trim();

                    if (!c1) {
                        ui.notifications.error("Historique : Connaissance démarre à 9 → choisis une spécialisation (texte).");
                        return false;
                    }

                    // si Connaissance est prise 2 fois : soit existing (ok), soit new (texte #2 obligatoire)
                    if (b1 === "Connaissance" && b2 === "Connaissance") {
                        const mode = String(this._copsPendingSpecsEdu?.connaissance2Mode ?? "existing");
                        if (mode === "new") {
                        const c2 = String(this._copsPendingSpecsEdu?.connaissance2 ?? "").trim()
                                || String(html.querySelector("#edu-connaissance-spec-2")?.value ?? "").trim();
                        if (!c2) {
                            ui.notifications.error("Historique : Connaissance (bonus 2) → nouvelle spé : texte obligatoire.");
                            return false;
                        }
                        }
                    }
                    }



                // --- Pré-check niveaux contacts (max 4) + max 2 contacts au niveau 4 ---
                // Hypothèse: création = niveaux "initiaux" du wizard
                // Origine = +2, Éducation = +1, Entrée1 = +1, Entrée2 = +1
                // Si tu passes en "Améliorer", tu ajoutes le boost sur un contact existant.

                const preview = new Map(); // key=nom normalisé, value=boost total appliqué par le wizard

                const norm2 = (s) => String(s ?? "").trim().toLowerCase();
                const addBoost = (name, inc) => {
                const n = String(name ?? "").trim();
                if (!n) return;
                const k = norm2(n);
                preview.set(k, (preview.get(k) ?? 0) + inc);
                };

                // Origine (toujours create dans ton wizard actuel)
                {
                const nm = String(html.querySelector("#contact-origine-nom")?.value ?? "").trim();
                if (nm) addBoost(nm, 2);
                }

                // Éducation
                {
                const mode = html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create";
                if (mode === "upgrade") {
                    const pick = String(html.querySelector("#contact-educ-existing")?.value ?? "").trim();
                    if (pick) addBoost(pick, 1);
                } else {
                    const nm = String(html.querySelector("#contact-educ-nom")?.value ?? "").trim();
                    if (nm) addBoost(nm, 1);
                }
                }

                // Entrée 1
                {
                const mode = html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create";
                if (mode === "upgrade") {
                    const pick = String(html.querySelector("#contact-entree1-existing")?.value ?? "").trim();
                    if (pick) addBoost(pick, 1);
                } else {
                    const nm = String(html.querySelector("#contact-entree1-nom")?.value ?? "").trim();
                    if (nm) addBoost(nm, 1);
                }
                }

                // Entrée 2
                {
                const mode = html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create";
                if (mode === "upgrade") {
                    const pick = String(html.querySelector("#contact-entree2-existing")?.value ?? "").trim();
                    if (pick) addBoost(pick, 1);
                } else {
                    const nm = String(html.querySelector("#contact-entree2-nom")?.value ?? "").trim();
                    if (nm) addBoost(nm, 1);
                }
                }

                // On ne connait pas le niveau réel "avant wizard" des contacts existants.
                // MAIS dans ton cas problématique, tu arrives à 5 uniquement quand le même contact
                // reçoit trop de boosts dans le wizard (ex: Origine +2 + Éducation +1 + Entrée1 +1 + Entrée2 +1 = 5).
                // Donc on bloque si un même nom reçoit >4 de boosts au total.
                let countExactly4 = 0;
                const tooHigh = [];

                for (const [k, lvl] of preview.entries()) {
                if (lvl > 4) tooHigh.push({ name: k, lvl });
                if (lvl === 4) countExactly4++;
                }

                if (tooHigh.length) {
                ui.notifications.error(
                    "Contacts : niveau max = 4. Trop de points sur :\n- " +
                    tooHigh.map(x => `${x.name} (niveau ${x.lvl})`).join("\n- ")
                );
                return false;
                }

                if (countExactly4 > 2) {
                ui.notifications.error("Contacts : maximum 2 contacts au niveau 4.");
                return false;
                }
                // --- fin pré-check contacts ---

                // ✅ Prévalidation : compétences déjà spécialisées via Éducation (Conduite / Corps à corps)
                // Si bonus1 ou bonus2 = Conduite / Corps à corps => il faut un choix de spé ciblée
                {
                const isAlreadySpecSkill = (s) => (s === "Conduite" || s === "Corps à corps");
                const b1 = String(html.querySelector("#edu-bonus-1")?.value ?? "");
                const b2 = String(html.querySelector("#edu-bonus-2")?.value ?? "");

                const checkSlot = (slot /*"b1"|"b2"*/, label) => {
                    const st = this._copsPendingSpecsEdu?.alreadySpec?.[slot];
                    if (!st) return null;

                    // st.skill doit matcher la compétence sélectionnée (sécurité)
                    const chosen = (slot === "b1") ? b1 : b2;
                    if (!isAlreadySpecSkill(chosen)) return null;

                    const mode = (st.mode === "new") ? "new" : "existing";
                    const spec = String(st.spec ?? "").trim();
                    if (!spec) {
                    return `${label} : ${chosen} → choisis une spécialisation (${mode === "existing" ? "existante" : "nouvelle"}).`;
                    }
                    return null;
                };

                const errs = [];
                const e1 = checkSlot("b1", "Historique (Bonus 1)");
                const e2 = checkSlot("b2", "Historique (Bonus 2)");
                if (e1) errs.push(e1);
                if (e2) errs.push(e2);

                if (errs.length) {
                    ui.notifications.error(errs.join("\n"));
                    return false;
                }
                }


            return true;
                        }

if (stepKey === "training") {
    if (isPending()) {
        ui.notifications.warn("Entraînement : termine ou annule le choix de spécialisation en cours.");
        return false;
    }
    const budget = parseInt(html.querySelector("#budget-display")?.textContent ?? "0");
    if (budget < 0) {
        ui.notifications.error("Budget Compétences dépassé !");
        return false;
    }
    return true;
}


            return true;
        };

        const goNext = () => {
            if (!validateStep()) return;
            showStep(this._copsStep + 1);
        };

        const goPrev = () => {
            const nextStep = Math.max(0, this._copsStep - 1);

            // "Retour" reset les étapes suivantes
            if (nextStep <= 2) resetTraining();
            if (nextStep <= 1) resetHistory();

            showStep(nextStep);
        };

        // Bind une seule fois
        if (!this._copsBoundFlow) {
            this._copsBoundFlow = true;

            footerNext?.addEventListener("click", (e) => { e.preventDefault(); goNext(); });
            footerPrev?.addEventListener("click", (e) => { e.preventDefault(); goPrev(); });

            footerFinish?.addEventListener("click", async (e) => {
                e.preventDefault();
                if (isPending()) {
                    ui.notifications.warn("Entraînement : termine ou annule le choix de spécialisation en cours.");
                    return;
                }
                await this._finishCreation();
            });

            // Re-clamp si l'utilisateur redimensionne la fenêtre (évite que le footer sorte de l’écran)
            if (!this._copsResizeObserver) {
            this._copsResizeObserver = new ResizeObserver(() => {
                try {
                const root = this.element; // <dialog>
                if (!root) return;

                const margin = 80;
                const maxH = Math.max(600, window.innerHeight - margin);
                const h = root.getBoundingClientRect().height;

                // Si ça dépasse l'écran -> on réduit
                if (h > maxH) this.setPosition({ height: maxH, top: Math.max(0, (window.innerHeight - maxH) / 2) });
                } catch (e) {}
            });

            const root = this.element;
            if (root) this._copsResizeObserver.observe(root);
            }

            const footerCancel = html.querySelector("[data-action='cancelWizard']");
            footerCancel?.addEventListener("click", async (e) => {
            e.preventDefault();

            // Autorise la fermeture + annule la création
            this._copsAllowClose = true;

            // Supprime l'acteur si on annule (évite l'acteur vierge)
            const actorId = this.options?.window?.actorId;
            const actor = actorId ? game.actors.get(actorId) : null;
            try {
                if (actor) await actor.delete();
            } catch (err) {
                console.warn("COPS | cancel: delete actor failed", err);
            }

            await this.close();
            });


        }

        // affiche l'étape courante
        showStep(this._copsStep);


        // 2. CARACTÉRISTIQUES (LIGNE)
        const caracsList = html.querySelector("#caracs-list");
        const pointsDisplay = html.querySelector("#carac-points");
        let stats = {}; 
        CARACS_LIST.forEach(k => stats[k] = 2);

        const renderStats = () => {
            let totalUsed = 0;
            Object.values(stats).forEach(v => totalUsed += v);
            let free = 21 - totalUsed;
            pointsDisplay.textContent = free;
            pointsDisplay.dataset.used = totalUsed;
            
            caracsList.innerHTML = CARACS_LIST.map(key => {
                const val = stats[key];
                const label = key.charAt(0).toUpperCase() + key.slice(1);
                const canMinus = val > 2;
                const canPlus = val < 5 && free > 0;
                return `
                <div class="carac-row">
                    <span class="carac-label">${label}</span>
                    <div class="carac-controls">
                        <button type="button" class="stat-minus" data-key="${key}" ${!canMinus ? 'disabled' : ''} style="background:${!canMinus?'#333':'#b44'}; color:#fff;">-</button>
                        <span id="stat-${key}" class="carac-value">${val}</span>
                        <button type="button" class="stat-plus" data-key="${key}" ${!canPlus ? 'disabled' : ''} style="background:${!canPlus?'#333':'#4b4'}; color:#fff;">+</button>
                    </div>
                </div>`;
            }).join("");
        };
        
        caracsList.addEventListener("click", (e) => {
            if (e.target.classList.contains("stat-plus")) {
                const k = e.target.dataset.key;
                if (stats[k] < 5) { stats[k]++; renderStats(); }
            } else if (e.target.classList.contains("stat-minus")) {
                const k = e.target.dataset.key;
                if (stats[k] > 2) { stats[k]--; renderStats(); }
            }
        });
        renderStats();

        // 3. LOGIQUE TEXTES & RESSOURCES (CHAINÉE & DYNAMIQUE)
        const updatePlaceholders = () => {
            const oriVal = html.querySelector("#sel-origine").value;
            const eduVal = html.querySelector("#sel-educ").value;
            const entVal = html.querySelector("#sel-entree").value;

            const f1 = html.querySelector("#contact-origine-nom");
            const f2 = html.querySelector("#contact-educ-nom");
            const f3 = html.querySelector("#contact-entree1-nom");
            const f4 = html.querySelector("#contact-entree2-nom");

            if(f1) f1.placeholder = CONTACT_HINTS[oriVal] || "Nom Contact";
            if(f2) f2.placeholder = CONTACT_HINTS[eduVal] || "Nom Contact";
            if(f3) f3.placeholder = CONTACT_HINTS[entVal] || "Nom Contact";
            if(f4) f4.placeholder = CONTACT_HINTS[entVal] || "Nom Contact";
        };

        const updateEduBonus = () => {
            let skills = [];
            const val = html.querySelector("#sel-educ").value;
            if (val === "rue") skills = ["Arme de contact", "Arme de poing", "Athlétisme", "Mécanique"];
            else if (val === "minimale") skills = ["Athlétisme", "Conduite", "Connaissance", "Corps à corps"];
            else if (val === "lycee") skills = ["Athlétisme", "Connaissance", "Informatique", "Rhétorique"];
            else if (val === "sup") skills = ["Connaissance", "Électronique", "Informatique", "Médecine", "Psychologie"];
            
            const optionsHtml = skills.map(s => `<option value="${s}">${s}</option>`).join("");
            const s1 = html.querySelector("#edu-bonus-1");
            const s2 = html.querySelector("#edu-bonus-2");
            
            if(s1 && s2) {
                s1.innerHTML = optionsHtml;
                s2.innerHTML = optionsHtml;
            }
            
            const wizEduc = html.querySelector("#wiz-educ");
            if(wizEduc) wizEduc.value = html.querySelector("#sel-educ").options[html.querySelector("#sel-educ").selectedIndex].text;
        };

        // --- REFRESH UI : compétences déjà spécialisées via Éducation (Conduite / Corps à corps) ---
            const refreshEduAlreadySpecUI = async () => {
            const Skills = game.cops?.chargen?.skills;
            if (!Skills) return;

            const b1 = String(html.querySelector("#edu-bonus-1")?.value ?? "");
            const b2 = String(html.querySelector("#edu-bonus-2")?.value ?? "");

            // Helpers: récupérer la spé "de base" déjà existante
            const baseSpecFor = (skillName) => {
                if (skillName === "Conduite") {
                // STARTER_SKILLS contient Conduite spec: "Voiture"
                return ["Voiture"];
                }
                if (skillName === "Corps à corps") {
                // Profil: radio cacSpec
                const s = String(html.querySelector("input[name='cacSpec']:checked")?.value ?? "").trim();
                return s ? [s] : [];
                }
                return [];
            };

            // Helper: specs déjà “créées” par le bonus1 (si bonus1 a choisi "new")
            const pendingNewFromBonus1 = () => {
                const s = this._copsPendingSpecsEdu?.alreadySpec?.b1;
                if (!s) return [];
                if (s.mode === "new" && s.skill && s.spec) return [String(s.spec)];
                return [];
            };

            const isTargetSkill = (s) => (s === "Conduite" || s === "Corps à corps");

            const applyFor = async (slot /* "b1"|"b2" */, skillName) => {
                const isB1 = (slot === "b1");

                const block  = html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-block" : "#edu-bonus-2-alreadySpec-block");
                const title  = html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-title" : "#edu-bonus-2-alreadySpec-title");
                const selEx  = html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-existing" : "#edu-bonus-2-alreadySpec-existing");
                const selNew = html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-new" : "#edu-bonus-2-alreadySpec-new");

                const wrapEx = html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-existing-wrap" : "#edu-bonus-2-alreadySpec-existing-wrap");
                const wrapNew= html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-new-wrap" : "#edu-bonus-2-alreadySpec-new-wrap");

                if (!block || !title || !selEx || !selNew || !wrapEx || !wrapNew) return;

                const st = this._copsPendingSpecsEdu.alreadySpec[slot];

                // si ce bonus n'est pas Conduite / CàC -> on cache et reset
                if (!isTargetSkill(skillName)) {
                block.style.display = "none";
                st.skill = "";
                st.mode = "existing";
                st.spec = "";
                return;
                }

                // show
                block.style.display = "";
                title.textContent = `${skillName} : choisir une spécialisation`;

                // construire la liste des "existantes"
                let existing = baseSpecFor(skillName);

                // ✅ si on est sur bonus2 et bonus1 a créé une nouvelle spé sur le même skill -> bonus2 doit la voir
                if (!isB1 && this._copsPendingSpecsEdu.alreadySpec.b1.skill === skillName) {
                existing = [...existing, ...pendingNewFromBonus1()];
                }

                // unique
                existing = [...new Map(existing.map(x => [String(x).toLowerCase(), String(x)])).values()];

                // options "nouvelles" depuis compendium (specialisationOptions) moins celles existantes
                const cfg = await Skills.getSkillConfig(skillName);
                const all = Array.isArray(cfg?.specialisationOptions) ? cfg.specialisationOptions.map(String) : [];
                const existingKey = new Set(existing.map(x => x.toLowerCase()));
                const remainingNew = all.filter(x => x && !existingKey.has(x.toLowerCase()));

                // remplir selects
                selEx.innerHTML  = `<option value="">— Choisir —</option>` + existing.map(x => `<option value="${x}">${x}</option>`).join("");
                selNew.innerHTML = `<option value="">— Choisir —</option>` + remainingNew.map(x => `<option value="${x}">${x}</option>`).join("");

                // restaurer state
                const mode = (st.mode === "new") ? "new" : "existing";
                st.skill = skillName;

                // toggle wraps
                wrapEx.style.display  = (mode === "existing") ? "" : "none";
                wrapNew.style.display = (mode === "new") ? "" : "none";

                // restore value si possible, sinon reset spec
                if (st.spec) {
                if (mode === "existing" && [...selEx.options].some(o => o.value === st.spec)) selEx.value = st.spec;
                else if (mode === "new" && [...selNew.options].some(o => o.value === st.spec)) selNew.value = st.spec;
                else st.spec = "";
                }
            };

            await applyFor("b1", b1);
            await applyFor("b2", b2);
            };


        // --- REFRESH UI : Spécialisation Éducation -> Arme de contact (palier) ---
            const refreshEduArmeContactSpecUI = async () => {
            const Skills = game.cops?.chargen?.skills;
            if (!Skills) return; // chargen pas prêt

            const block = html.querySelector("#edu-armecontact-spec-block");
            const sel = html.querySelector("#edu-armecontact-spec");
            if (!block || !sel) return;

            // On ne peut déclencher ce cas QUE si "Arme de contact" est choisie en bonus 1 ET bonus 2
            const b1 = html.querySelector("#edu-bonus-1")?.value ?? "";
            const b2 = html.querySelector("#edu-bonus-2")?.value ?? "";
            const bothAreArmeContact = (b1 === "Arme de contact" && b2 === "Arme de contact");

            // Si pas le cas -> on cache et on reset le select
            if (!bothAreArmeContact) {
                block.style.display = "none";
                sel.value = "";
                return;
            }

            // Ici: on affiche, et on remplit dynamiquement depuis le compendium
            block.style.display = "";

            const prev = sel.value; // conserve si déjà choisi
            sel.innerHTML = `<option value="">— Choisir —</option>`;

            const cfg = await Skills.getSkillConfig("Arme de contact");
            const opts = Array.isArray(cfg?.specialisationOptions) ? cfg.specialisationOptions : [];

            for (const o of opts) {
                const v = String(o ?? "").trim();
                if (!v) continue;
                const opt = document.createElement("option");
                opt.value = v;
                opt.textContent = v;
                sel.appendChild(opt);
            }

            // restaure choix précédent si toujours dispo
            if (prev && [...sel.options].some(op => op.value === prev)) sel.value = prev;
            };


            // --- REFRESH UI : Spécialisation Éducation -> Connaissance (9+) ---
            const refreshEduConnaissanceSpecUI = async () => {
                const Skills = game.cops?.chargen?.skills;
                if (!Skills) return;

                const b1 = String(html.querySelector("#edu-bonus-1")?.value ?? "");
                const b2 = String(html.querySelector("#edu-bonus-2")?.value ?? "");

                const block = html.querySelector("#edu-connaissance-spec-block");
                const input1 = html.querySelector("#edu-connaissance-spec-1");
                const input2 = html.querySelector("#edu-connaissance-spec-2");
                const dl = html.querySelector("#edu-connaissance-spec-datalist");

                const bonus2Block = html.querySelector("#edu-connaissance-bonus2-block");
                const bonus2NewWrap = html.querySelector("#edu-connaissance-bonus2-new-wrap");

                if (!block || !input1 || !dl || !bonus2Block || !bonus2NewWrap) return;

                const picked1 = (b1 === "Connaissance");
                const picked2 = (b2 === "Connaissance");
                const pickedCount = (picked1 ? 1 : 0) + (picked2 ? 1 : 0);

                // 0) pas active
                if (pickedCount === 0) {
                    block.style.display = "none";
                    input1.value = "";
                    if (input2) input2.value = "";
                    dl.innerHTML = "";
                    this._copsPendingSpecsEdu.connaissance1 = "";
                    this._copsPendingSpecsEdu.connaissance2Mode = "existing";
                    this._copsPendingSpecsEdu.connaissance2 = "";
                    bonus2Block.style.display = "none";
                    bonus2NewWrap.style.display = "none";
                    return;
                }

                // 1) active
                block.style.display = "";

                // suggestions (optionnelles)
                const cfg = await Skills.getSkillConfig("Connaissance");
                const opts = Array.isArray(cfg?.specialisationOptions) ? cfg.specialisationOptions : [];
                dl.innerHTML = "";
                for (const o of opts) {
                    const v = String(o ?? "").trim();
                    if (!v) continue;
                    const opt = document.createElement("option");
                    opt.value = v;
                    dl.appendChild(opt);
                }

                // restore input1
                input1.value = String(this._copsPendingSpecsEdu.connaissance1 ?? "");

                // 2) si Connaissance est prise 2 fois => montrer le bloc bonus2
                if (pickedCount === 2) {
                    bonus2Block.style.display = "";

                    const mode = (this._copsPendingSpecsEdu.connaissance2Mode === "new") ? "new" : "existing";
                    bonus2NewWrap.style.display = (mode === "new") ? "" : "none";

                    // restore radio
                    html.querySelectorAll(`input[name="eduConnaissanceBonus2Mode"]`).forEach(r => {
                    r.checked = (r.value === mode);
                    });

                    // restore input2 si présent
                    if (input2) input2.value = String(this._copsPendingSpecsEdu.connaissance2 ?? "");
                } else {
                    // sinon on cache bonus2 + reset 2e choix
                    bonus2Block.style.display = "none";
                    bonus2NewWrap.style.display = "none";
                    this._copsPendingSpecsEdu.connaissance2Mode = "existing";
                    this._copsPendingSpecsEdu.connaissance2 = "";
                    if (input2) input2.value = "";
                }
            };


        // --- ÉDUCATION : UI spécialisation Informatique (palier 5) ---
           if (!this._copsPendingSpecsEdu) {
            this._copsPendingSpecsEdu = {
                edu1: "",
                edu2: "",
                arme: "",
                connaissance1: "",
                connaissance2Mode: "existing", // "existing" | "new"
                connaissance2: "",


                // ✅ choix “compétence déjà spécialisée” (Conduite / Corps à corps) par bonus
                alreadySpec: {
                b1: { skill: "", mode: "existing", spec: "" },
                b2: { skill: "", mode: "existing", spec: "" }
                }
            };
            }



            const refreshEduInformatiqueSpecUI = async () => {
            const Skills = game.cops?.chargen?.skills;
            if (!Skills) return;

            const b1 = html.querySelector("#edu-bonus-1");
            const b2 = html.querySelector("#edu-bonus-2");
            const root = html.querySelector("#edu-informatique-specs");
            const w1 = html.querySelector("#edu-bonus-1-spec-wrap");
            const w2 = html.querySelector("#edu-bonus-2-spec-wrap");
            const s1 = html.querySelector("#edu-bonus-1-spec");
            const s2 = html.querySelector("#edu-bonus-2-spec");

            if (!b1 || !b2 || !root || !w1 || !w2 || !s1 || !s2) return;

            const isInfo1 = (String(b1.value ?? "") === "Informatique");
            const isInfo2 = (String(b2.value ?? "") === "Informatique");

            // ✅ On n'affiche QUE si les 2 bonus = Informatique (car 7 -> 5)
            const needInfoSpec = isInfo1 && isInfo2;

            root.style.display = needInfoSpec ? "" : "none";
            w1.style.display = needInfoSpec ? "" : "none";
            w2.style.display = "none"; // on ne garde qu'un seul choix de spé


            // Remplit les options de spé depuis le compendium (specialisationOptions)
            // (on ne le fait qu'une fois si déjà rempli)
            const fill = async (selectEl) => {
                if (selectEl.dataset.filled === "1") return;
                const cfg = await Skills.getSkillConfig("Informatique");
                const opts = Array.isArray(cfg.specialisationOptions) ? cfg.specialisationOptions : [];
                selectEl.innerHTML = `<option value="">— Choisir —</option>` + opts.map(o => `<option value="${o}">${o}</option>`).join("");
                selectEl.dataset.filled = "1";
            };

            if (isInfo1) await fill(s1);
            if (isInfo2) await fill(s2);

            // Restaure choix précédents
            if (isInfo1 && this._copsPendingSpecsEdu.edu1) s1.value = this._copsPendingSpecsEdu.edu1;
            if (isInfo2 && this._copsPendingSpecsEdu.edu2) s2.value = this._copsPendingSpecsEdu.edu2;
            };


        const updateResources = () => {
            const oriSelect = html.querySelector("#sel-origine");
            const entSelect = html.querySelector("#sel-entree");
            const wizOrigine = html.querySelector("#wiz-origine");
            const wizEntree = html.querySelector("#wiz-entree");
            
            if(wizOrigine) wizOrigine.value = oriSelect.options[oriSelect.selectedIndex].text;
            if(wizEntree) wizEntree.value = entSelect.options[entSelect.selectedIndex].text;
            
            const ent = entSelect.value;
            const fedDiv = html.querySelector("#federale-choice");
            
            // Gestion Affichage Fédérale
            if(ent === "federale") fedDiv.style.display = "block";
            else fedDiv.style.display = "none";

            // Calcul Ressources
            let anc=0, adr=0;
            if (ent === "academie") { anc=2; adr=0; }
            else if (ent === "armee") { anc=1; adr=1; }
            else if (ent === "concours") { anc=1; adr=1; }
            else if (ent === "sportif") { anc=0; adr=2; }
            else if (ent === "piston") { anc=2; adr=0; }
            else if (ent === "federale") {
                const fedOpt = html.querySelector("input[name='fedOption']:checked").value;
                if(fedOpt === "1") { anc=1; adr=1; }
                else { anc=2; adr=0; }
            }
            
            const descDiv = html.querySelector("#desc-entree");
            if(descDiv) {
                // CORRECTION : ON NE CHANGE PAS L'ID DE LA DIV
                // On met à jour le texte visible
                descDiv.innerHTML = `Ressources : Anc ${anc} / Adr ${adr}`;
                
                // On crée/met à jour les spans invisibles pour le stockage des données
                let resSpan = descDiv.querySelector(".res-values");
                if(!resSpan) {
                    resSpan = document.createElement("span");
                    resSpan.className = "res-values";
                    resSpan.style.display = "none"; 
                    descDiv.appendChild(resSpan);
                }
                resSpan.innerHTML = `<span id="res-anc" data-value="${anc}"></span><span id="res-adr" data-value="${adr}"></span>`;
            }
        };

        // --- CONTACTS ENGINE A : UI create/upgrade + dropdown ---
            const actorId = this.options?.window?.actorId;
            const actor = actorId ? game.actors.get(actorId) : null;

            // liste de contacts existants sur l'acteur (on essaye plusieurs types pour être robuste)
                        // Helpers
            const norm = (s) => String(s ?? "").trim();
            const normKey = (s) => norm(s).toLowerCase();

            const fillSelect = (sel, names) => {
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = `<option value="">— Choisir —</option>` + names.map(n => `<option value="${n}">${n}</option>`).join("");
            // essaie de garder le choix si encore présent
            if (names.includes(current)) sel.value = current;
            };

            // contacts existants SUR L'ACTEUR (si on ouvre le wizard sur un PJ déjà fait)
            const getActorContacts = () => {
            if (!actor) return [];
            return actor.items
                .filter(i => ["contact", "contacts"].includes(i.type))
                .map(i => norm(i.name))
                .filter(Boolean);
            };

            // contacts “en cours” SAISIS DANS LE WIZARD (create-mode)
            const getDraftContactsFromWizard = () => {
            const names = [];

            // Origine = create (même si nom pas obligatoire)
            const o = norm(html.querySelector("#contact-origine-nom")?.value);
            if (o) names.push(o);

            // Éducation : seulement si mode=create
            const em = html.querySelector(`input[name="educContactMode"]:checked`)?.value ?? "create";
            if (em === "create") {
                const n = norm(html.querySelector("#contact-educ-nom")?.value);
                if (n) names.push(n);
            }

            // Entrée 1 : seulement si mode=create
            const m1 = html.querySelector(`input[name="entree1ContactMode"]:checked`)?.value ?? "create";
            if (m1 === "create") {
                const n = norm(html.querySelector("#contact-entree1-nom")?.value);
                if (n) names.push(n);
            }

            // Entrée 2 : seulement si mode=create
            const m2 = html.querySelector(`input[name="entree2ContactMode"]:checked`)?.value ?? "create";
            if (m2 === "create") {
                const n = norm(html.querySelector("#contact-entree2-nom")?.value);
                if (n) names.push(n);
            }

            // Free contact #1 : seulement si mode=create
            const f1 = html.querySelector(`input[name="free1ContactMode"]:checked`)?.value ?? "create";
            if (f1 === "create") {
                const n = norm(html.querySelector("#contact-free1-nom")?.value);
                if (n) names.push(n);
            }

            // Free contact #2 : seulement si mode=create
            const f2 = html.querySelector(`input[name="free2ContactMode"]:checked`)?.value ?? "create";
            if (f2 === "create") {
                const n = norm(html.querySelector("#contact-free2-nom")?.value);
                if (n) names.push(n);
            }


            // unique case-insensitive
            const uniq = new Map();
            for (const n of names) uniq.set(normKey(n), n);
            return [...uniq.values()].sort((a, b) => a.localeCompare(b));
            };

            const getSelectableContacts = () => {
            const all = [...getActorContacts(), ...getDraftContactsFromWizard()];
            const uniq = new Map();
            for (const n of all) uniq.set(normKey(n), n);
            return [...uniq.values()].sort((a, b) => a.localeCompare(b));
            };

            const refreshContactDropdowns = () => {
            const names = getSelectableContacts();

            fillSelect(html.querySelector("#contact-educ-existing"), names);
            fillSelect(html.querySelector("#contact-entree1-existing"), names);
            fillSelect(html.querySelector("#contact-entree2-existing"), names);

            // ✅ AJOUT : points libres
            fillSelect(html.querySelector("#contact-free1-existing"), names);
            fillSelect(html.querySelector("#contact-free2-existing"), names);
            };

            // Refresh dropdowns quand on tape un nom (pour rendre les listes non-vides)
                [
                "#contact-origine-nom",
                "#contact-educ-nom",
                "#contact-entree1-nom",
                "#contact-entree2-nom",
                "#contact-free1-nom",
                "#contact-free2-nom"
                ].forEach(sel => {
                html.querySelector(sel)?.addEventListener("input", () => refreshContactDropdowns());
                });

                // Refresh dropdowns quand on change create/upgrade
                ["educContactMode", "entree1ContactMode", "entree2ContactMode", "free1ContactMode", "free2ContactMode"].forEach(radioName => {
                html.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
                    r.addEventListener("change", () => refreshContactDropdowns());
                });
                });

                // Premier remplissage
                refreshContactDropdowns();



            const bindModeToggle = (radioName, createRowId, upgradeRowId, typeSelectId = null) => {
            const radios = html.querySelectorAll(`input[name="${radioName}"]`);
            const createRow = html.querySelector(`#${createRowId}`);
            const upgradeRow = html.querySelector(`#${upgradeRowId}`);
            const typeSel  = typeSelectId ? html.querySelector(`#${typeSelectId}`) : null;

            const apply = () => {
                const mode = html.querySelector(`input[name="${radioName}"]:checked`)?.value ?? "create";

                if (createRow)  createRow.style.display  = (mode === "create")  ? "" : "none";
                if (upgradeRow) upgradeRow.style.display = (mode === "upgrade") ? "" : "none";

                // ✅ Le type n'a de sens QUE en create
                if (typeSel) typeSel.style.display = (mode === "create") ? "" : "none";
            };

            radios.forEach(r => r.addEventListener("change", apply));
            apply();
            };


           // bind toggles (+ hide type when upgrade)
            bindModeToggle("educContactMode",   "educ-create-row",   "educ-upgrade-row",   "contact-educ-type");
            bindModeToggle("entree1ContactMode","entree1-create-row","entree1-upgrade-row","contact-entree1-type");
            bindModeToggle("entree2ContactMode","entree2-create-row","entree2-upgrade-row","contact-entree2-type");
            bindModeToggle("free1ContactMode",  "free1-create",      "free1-upgrade",      "contact-free1-type");
            bindModeToggle("free2ContactMode",  "free2-create",      "free2-upgrade",      "contact-free2-type");


            // remplir les dropdowns au render (et tu peux rappeler après création si besoin)
            refreshContactDropdowns();


        // Listeners groupés (Chainage)
            html.querySelector("#sel-educ").addEventListener("change", async () => {
            updateEduBonus();
            updatePlaceholders();
            

            // ✅ refresh UI spé après regen des selects
            await refreshEduInformatiqueSpecUI();
            await refreshEduArmeContactSpecUI();
            await refreshEduConnaissanceSpecUI();
            await refreshEduAlreadySpecUI();
            });


        html.querySelector("#sel-origine").addEventListener("change", () => { updateResources(); updatePlaceholders(); });
        html.querySelector("#sel-entree").addEventListener("change", () => { updateResources(); updatePlaceholders(); });
        
        // Listener Radio Fédérale
        html.querySelectorAll("input[name='fedOption']").forEach(r => {
            r.addEventListener("change", () => updateResources());
        });

        // Spécialisation Informatique : refresh + stockage
            html.querySelector("#edu-bonus-1")?.addEventListener("change", async () => {
            await refreshEduInformatiqueSpecUI();
            await refreshEduArmeContactSpecUI();
            await refreshEduConnaissanceSpecUI();
            await refreshEduAlreadySpecUI();
            });

            html.querySelector("#edu-bonus-2")?.addEventListener("change", async () => {
            await refreshEduInformatiqueSpecUI();
            await refreshEduArmeContactSpecUI();
            await refreshEduConnaissanceSpecUI();
            await refreshEduAlreadySpecUI();
            });


            html.querySelector("#edu-bonus-1-spec")?.addEventListener("change", (e) => {
            const v = String(e.target.value ?? "");
            this._copsPendingSpecsEdu.edu1 = v;
            this._copsPendingSpecsEdu.edu2 = v; // ✅ même choix pour les 2 bonus
            });

            html.querySelector("#edu-armecontact-spec")?.addEventListener("change", (e) => {
            const v = String(e.target.value ?? "");
            this._copsPendingSpecsEdu.arme = v;
            });

          // Connaissance : input #1
            html.querySelector("#edu-connaissance-spec-1")?.addEventListener("input", (e) => {
            this._copsPendingSpecsEdu.connaissance1 = String(e.target.value ?? "").trim();
            });

            // Connaissance : mode bonus2 (existing/new)
            html.querySelectorAll(`input[name="eduConnaissanceBonus2Mode"]`).forEach(r => {
            r.addEventListener("change", async () => {
                const m = String(html.querySelector(`input[name="eduConnaissanceBonus2Mode"]:checked`)?.value ?? "existing");
                this._copsPendingSpecsEdu.connaissance2Mode = (m === "new") ? "new" : "existing";
                // si on repasse en existing, on vide le champ 2
                if (this._copsPendingSpecsEdu.connaissance2Mode !== "new") {
                this._copsPendingSpecsEdu.connaissance2 = "";
                const i2 = html.querySelector("#edu-connaissance-spec-2");
                if (i2) i2.value = "";
                }
                await refreshEduConnaissanceSpecUI();
            });
            });

            // Connaissance : input #2 (uniquement si mode=new)
            html.querySelector("#edu-connaissance-spec-2")?.addEventListener("input", (e) => {
            this._copsPendingSpecsEdu.connaissance2 = String(e.target.value ?? "").trim();
            });



            // --- AlreadySpec (Conduite / Corps à corps) : stockage ---
            const bindAlreadySpecSlot = (slot /*"b1"|"b2"*/) => {
            const isB1 = (slot === "b1");

            const modeName = isB1 ? "eduBonus1SpecMode" : "eduBonus2SpecMode";
            const selEx = html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-existing" : "#edu-bonus-2-alreadySpec-existing");
            const selNew= html.querySelector(isB1 ? "#edu-bonus-1-alreadySpec-new" : "#edu-bonus-2-alreadySpec-new");

            // radios
            html.querySelectorAll(`input[name="${modeName}"]`).forEach(r => {
                r.addEventListener("change", async () => {
                const v = String(html.querySelector(`input[name="${modeName}"]:checked`)?.value ?? "existing");
                const st = this._copsPendingSpecsEdu.alreadySpec[slot];
                st.mode = (v === "new") ? "new" : "existing";
                st.spec = ""; // reset à chaque switch
                await refreshEduAlreadySpecUI();
                });
            });

            // select existing
            selEx?.addEventListener("change", (e) => {
                const st = this._copsPendingSpecsEdu.alreadySpec[slot];
                st.mode = "existing";
                st.spec = String(e.target.value ?? "");
            });

            // select new
            selNew?.addEventListener("change", async (e) => {
                const st = this._copsPendingSpecsEdu.alreadySpec[slot];
                st.mode = "new";
                st.spec = String(e.target.value ?? "");

                // IMPORTANT : si bonus1 crée une nouvelle spé, bonus2 doit “voir” cette spé comme existante
                await refreshEduAlreadySpecUI();
            });
            };

            bindAlreadySpecSlot("b1");
            bindAlreadySpecSlot("b2");


        
        updateEduBonus();
        updateResources();
        updatePlaceholders();
        refreshEduInformatiqueSpecUI();
        refreshEduArmeContactSpecUI();
        refreshEduConnaissanceSpecUI();
        refreshEduAlreadySpecUI();

        // 4. BUDGET & DRAG/DROP
        const budgetDisplay = html.querySelector("#budget-display");
        const baseList = html.querySelector("#base-skills-list");
        const boughtList = html.querySelector("#bought-skills-list");
        let currentBudget = 10;
        
        // --- Correctif B : réafficher Corps à corps + Compétence sociale dans la colonne Base ---
        // (affichage uniquement pour l'instant, pas de -1/-2 ici : les diminutions spécialisées seront traitées en Étape 4B)
        const addFixedBaseRow = (name, level, extra = "") => {
            if (!baseList) return;
            const row = document.createElement("div");
            row.className = "base-skill-row-fixed";
            row.dataset.name = name;
            row.style.display = "grid";
            row.style.gridTemplateColumns = "1fr auto";
            row.style.columnGap = "10px";
            row.style.alignItems = "start";
            row.style.marginBottom = "4px";
            row.style.borderBottom = "1px solid #333";

            const extraHtml = extra ? `<span style="font-size:0.8em; color:#aaa; margin-left:8px;">${extra}</span>` : "";
            row.innerHTML = `<span>${name}${extraHtml}</span><div style="display:flex; align-items:center; gap:5px;"><span class="skill-level" style="font-weight:bold; color:#fff;">${level}</span></div>`;
            baseList.appendChild(row);
        };

        const refreshFixedBaseRows = () => {
            // Supprime les anciennes lignes (si on refresh)
            baseList?.querySelectorAll(".base-skill-row-fixed").forEach(el => el.remove());

            // Corps à corps : général bloqué à 8 (palier spé 7). On affiche au moins la spé choisie en Étape 2.
            const cacSpec = html.querySelector("input[name='cacSpec']:checked")?.value ?? "Coups";
            addFixedBaseRow("Corps à corps", 8, `Spé : ${cacSpec} (7)`);

            // Compétence sociale choisie à l'étape 2
            const socialName = html.querySelector("input[name='socialSkill']:checked")?.value ?? "Éloquence";
            addFixedBaseRow(socialName, 7);
        };

// === TRAINING : Pending action (1 seule à la fois) ===
// Une action devient "pending" quand elle nécessite un choix de spécialisation.
// Tant que pending != null :
// - on bloque les autres actions Training
// - on bloque la validation/terminer
if (!this._copsTrainingPending) this._copsTrainingPending = null;

const Skills = game.cops?.chargen?.skills;

const isPending = () => !!this._copsTrainingPending;

const blockIfPending = () => {
    if (!isPending()) return false;
    ui.notifications.warn("Entraînement : termine ou annule le choix de spécialisation en cours.");
    return true;
};

	const syncFinishButtonState = () => {
	    const btnFinish = html.querySelector("[data-action='finishWizard']");
	    if (btnFinish) {
	        btnFinish.disabled = isPending();
	        btnFinish.title = isPending() ? "Termine ou annule l'action en attente avant de créer." : "";
	    }
	};
	const setPending = (pending) => { this._copsTrainingPending = pending; syncFinishButtonState(); };
	const clearPending = () => { this._copsTrainingPending = null; syncFinishButtonState(); };
		// initialise l'état du bouton (utile lors d'un retour sur l'étape 4)
		syncFinishButtonState();

const needsSpecNow = async (skillName, newLevel) => {
    if (!Skills) return null;
    const cfg = await Skills.getSkillConfig(skillName);
    const at = Number(cfg?.specialisationAt ?? 0);
    if (!at) return null;
    // Dans ce système, plus le chiffre est petit, meilleur est le niveau.
    // La spécialisation devient requise dès qu'on atteint un niveau <= palier.
    if (Number(newLevel) <= at) return cfg;
    return null;
};

const renderSpecPicker = (rowEl, cfg, { onConfirm, onCancel }) => {
    // Nettoie un éventuel picker précédent sur cette row
    rowEl.querySelectorAll(".cops-spec-picker").forEach(n => n.remove());

    const wrap = document.createElement("div");
    wrap.className = "cops-spec-picker";
    wrap.style.margin = "6px 0 8px 0";
    wrap.style.padding = "8px";
    wrap.style.border = "1px dashed #666";
    wrap.style.borderRadius = "6px";
    wrap.style.background = "rgba(0,0,0,0.25)";

    const title = document.createElement("div");
    title.style.fontSize = "0.9em";
    title.style.marginBottom = "6px";
    title.innerHTML = `<strong>Spécialisation requise</strong> (palier ${cfg.specialisationAt})`;
    wrap.appendChild(title);

    let inputEl;
    if ((cfg.specialisationMode ?? "fixed") === "free") {
        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.placeholder = "Spécialisation…";
        inputEl.style.width = "100%";
    } else {
        inputEl = document.createElement("select");
        inputEl.style.width = "100%";
        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "— Choisir une spécialisation —";
        inputEl.appendChild(opt0);
        (cfg.specialisationOptions ?? []).forEach(o => {
            const opt = document.createElement("option");
            opt.value = o;
            opt.textContent = o;
            inputEl.appendChild(opt);
        });
    }
    wrap.appendChild(inputEl);

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";
    btnRow.style.marginTop = "8px";
    btnRow.style.justifyContent = "flex-end";

    const bCancel = document.createElement("button");
    bCancel.type = "button";
    bCancel.textContent = "Annuler";
    bCancel.addEventListener("click", (e) => {
        e.preventDefault();
        onCancel?.();
    });

    const bOk = document.createElement("button");
    bOk.type = "button";
    bOk.textContent = "Valider";
    bOk.addEventListener("click", (e) => {
        e.preventDefault();
        const v = String(inputEl.value ?? "").trim();
        if (!v) return ui.notifications.error("Choisis une spécialisation.");
        onConfirm?.(v);
    });

    btnRow.appendChild(bCancel);
    btnRow.appendChild(bOk);
    wrap.appendChild(btnRow);

    rowEl.appendChild(wrap);
    return wrap;
};




        // --- Base list (kit de base complet) ---
        // Objectif UI : inclure aussi Corps à corps + le choix social (Éloquence/Rhétorique/Intimidation)
        // et refléter immédiatement l'état réel des compétences APRÈS l'Étape 3 (Historique).
        //
        // IMPORTANT :
        // - aucune valeur en dur (paliers/spé) côté règles : on s'appuie sur les décisions déjà stockées à l'Étape 3
        //   (this._copsPendingSpecsEdu, choix Profil, etc.)
        // - l'Étape 4 ne refait PAS la logique métier : elle affiche un "snapshot pré-Training".

        const getCacSpec = () => String(html.querySelector("input[name='cacSpec']:checked")?.value ?? "").trim();
        const getSocialName = () => String(html.querySelector("input[name='socialSkill']:checked")?.value ?? "").trim();

        // Reconstruit l'état "post-Historique" (pré-Training).
        // Retour :
        // - base:    { levels, specs }  => compétences du kit de base (colonne Base)
        // - history: { levels, specs }  => compétences hors kit acquises via l'Historique (colonne Achat)
        //
        // Règle validée :
        // - une compétence hors starter set est "diminuable" en Training uniquement si elle provient de l'Historique.
        const buildPreTrainingState = async () => {
            const levels = new Map();
            const specs  = new Map();

            const hLevels = new Map();
            const hSpecs  = new Map();

            const addSpec = (mapSpecs, skill, spec, level) => {
                if (!spec) return;
                const arr = mapSpecs.get(skill) ?? [];
                // évite doublon (case-insensitive)
                const exists = arr.find(x => String(x.spec).toLowerCase() === String(spec).toLowerCase());
                if (exists) {
                    exists.level = level; // écrase (dernière valeur)
                } else {
                    arr.push({ spec, level });
                }
                mapSpecs.set(skill, arr);
            };

            // 1) Starter kit
            for (const s of STARTER_SKILLS) {
                levels.set(s.name, s.niveau);
                if (s.spec) addSpec(specs, s.name, s.spec, s.niveau); // ex: Conduite : Voiture
            }

            // 2) Profil : Corps à corps + Social (font partie du kit de base)
            const cacSpec = getCacSpec() || "Coups";
            levels.set("Corps à corps", 7);
            addSpec(specs, "Corps à corps", cacSpec, 7);

            const socialName = getSocialName();
            if (socialName) levels.set(socialName, 7);

            // 3) Historique : Éducation (2 sélections = -1 chacune sur le GÉNÉRAL, sauf compétences déjà spécialisées)
            const b1 = String(html.querySelector("#edu-bonus-1")?.value ?? "");
            const b2 = String(html.querySelector("#edu-bonus-2")?.value ?? "");

            const applyEduMinus1 = (skillName) => {
                if (!skillName) return;
                // Compétences déjà spécialisées : pas de modif du général en Historique (Conduite / CàC)
                if (skillName === "Conduite" || skillName === "Corps à corps") return;
                // Dans notre UI "Base", on ne modifie que les compétences du kit
                if (!levels.has(skillName)) return;

                levels.set(skillName, Math.max(5, (levels.get(skillName) ?? 10) - 1));
            };

            applyEduMinus1(b1);
            applyEduMinus1(b2);

            // 3b) Historique : compétences HORS KIT (acquises via Éducation)
            // Elles ne sont pas dans la colonne Base, mais doivent apparaître en colonne Achat
            // avec boutons -1/-2 activables (car issues Historique).
            const applyEduOther = (skillName) => {
                if (!skillName) return;
                // Déjà dans le kit (colonne Base) => pas une compétence "hors starter".
                if (levels.has(skillName)) return;
                // Compétences déjà spécialisées gérées ailleurs
                if (skillName === "Conduite" || skillName === "Corps à corps") return;

                // 1er gain : niveau 9. 2e gain : -1.
                if (!hLevels.has(skillName)) hLevels.set(skillName, 9);
                else hLevels.set(skillName, Math.max(5, (hLevels.get(skillName) ?? 9) - 1));
            };
            applyEduOther(b1);
            applyEduOther(b2);

            // 4) Historique : déclenchements de spécialisations via Éducation
            // - Informatique : si prise 2 fois => niveau 5 => spé obligatoire (fixed, choix stocké dans this._copsPendingSpecsEdu.edu1)
            // - Arme de contact : si prise 2 fois => niveau 6 => spé obligatoire (fixed, choix stocké dans this._copsPendingSpecsEdu.arme)
            if (b1 === "Informatique" && b2 === "Informatique") {
                const pick = String(this._copsPendingSpecsEdu?.edu1 ?? "").trim(); // même valeur utilisée à la finalisation
                if (pick) {
                    const cfg = await Skills.getSkillConfig("Informatique");
                    const at = Number(cfg?.specialisationAt ?? 5);
                    // Si Informatique est dans le kit, ça va dans Base. Sinon, ça va dans History.
                    const targetSpecs = levels.has("Informatique") ? specs : hSpecs;
                    addSpec(targetSpecs, "Informatique", pick, Math.max(5, at));
                }
            }
            if (b1 === "Arme de contact" && b2 === "Arme de contact") {
                const pick = String(this._copsPendingSpecsEdu?.arme ?? "").trim();
                if (pick) {
                    const cfg = await Skills.getSkillConfig("Arme de contact");
                    const at = Number(cfg?.specialisationAt ?? 6);
                    // Lorsqu'une spé est déclenchée, elle démarre au palier.
                    const targetSpecs = levels.has("Arme de contact") ? specs : hSpecs;
                    addSpec(targetSpecs, "Arme de contact", pick, Math.max(5, at));
                }
            }

            // Connaissance (si acquise en Éducation) : hors kit dans la majorité des cas
            if (b1 === "Connaissance" || b2 === "Connaissance") {
                const spec1 = String(this._copsPendingSpecsEdu?.connaissance1 ?? "").trim();
                if (spec1) {
                    if (!hLevels.has("Connaissance")) hLevels.set("Connaissance", 9);
                    addSpec(hSpecs, "Connaissance", spec1, 9);

                    // Si prise 2 fois et mode "new", on affiche aussi la 2e spé (à 9)
                    if (b1 === "Connaissance" && b2 === "Connaissance") {
                        const mode2 = String(this._copsPendingSpecsEdu?.connaissance2Mode ?? "existing");
                        const spec2 = String(this._copsPendingSpecsEdu?.connaissance2 ?? "").trim();
	                        if (mode2 === "new") {
	                            if (spec2 && spec2.toLowerCase() !== spec1.toLowerCase()) {
	                                addSpec(hSpecs, "Connaissance", spec2, 9);
	                            }
	                        } else {
	                            // mode2 === existing : améliore une spé existante (-1) => doit se voir en Étape 4
	                            // Par défaut on améliore spec1 (comme la finalisation).
	                            const arr = hSpecs.get("Connaissance") ?? [];
	                            const it = arr.find(x => String(x.spec).toLowerCase() === String(spec1).toLowerCase());
	                            if (it) it.level = Math.max(5, (Number(it.level ?? 9) - 1));
	                            hSpecs.set("Connaissance", arr);
	                        }
                    }
                }
            }

            // 5) Historique : compétences déjà spécialisées via Éducation (Conduite / Corps à corps)
            // Règle : jamais le général, uniquement une spé existante OU une nouvelle spé.
            // - existing => -1 sur la spé ciblée
            // - new => création d'une nouvelle spé à 8 (cf. logique de finalisation)
            const applyAlreadySpecEdu = async (slot /*"b1"|"b2"*/, skillName) => {
                if (skillName !== "Conduite" && skillName !== "Corps à corps") return;
                const st = this._copsPendingSpecsEdu?.alreadySpec?.[slot];
                if (!st) return;

                const mode = (st.mode === "new") ? "new" : "existing";
                const chosenSpec = String(st.spec ?? "").trim();
                if (!chosenSpec) return;

                if (mode === "new") {
                    // Nouvelle spé : valeur de départ = palier de spécialisation (pas le général)
                    const cfg = await Skills.getSkillConfig(skillName);
                    const at = Number(cfg?.specialisationAt ?? 8);
                    addSpec(specs, skillName, chosenSpec, Math.max(5, at));
                } else {
                    // existing : -1 (peut arriver 2 fois)
                    const arr = specs.get(skillName) ?? [];
                    const it = arr.find(x => String(x.spec).toLowerCase() === String(chosenSpec).toLowerCase());
                    if (it) it.level = Math.max(5, (it.level ?? (levels.get(skillName) ?? 7)) - 1);
                    else addSpec(specs, skillName, chosenSpec, Math.max(5, (levels.get(skillName) ?? 7) - 1));
                    specs.set(skillName, arr);
                }
            };

            await applyAlreadySpecEdu("b1", b1);
            await applyAlreadySpecEdu("b2", b2);

            // Clamp final (sécurité)
            for (const [k, v] of levels) levels.set(k, Math.max(5, Math.min(10, Number(v))));
            for (const [k, v] of hLevels) hLevels.set(k, Math.max(5, Math.min(10, Number(v))));

            return { base: { levels, specs }, history: { levels: hLevels, specs: hSpecs } };
        };

        const renderBaseRow = (skillName, displayLevel, actualLevel, specArr = []) => {
            // Wrapper row (column) to keep the right controls perfectly aligned,
            // regardless of how many specialisations are displayed underneath.
            const row = document.createElement("div");
            row.className = "base-skill-row";
            row.dataset.name = skillName;
            // baseLevel = niveau affiché (peut être bloqué au palier+1 si spé)
            row.dataset.baseLevel = String(displayLevel);
            // baseLevelActual = niveau "réel" du snapshot pré-training (utilisé par la finalisation)
            row.dataset.baseLevelActual = String(actualLevel);
            row.dataset.specsJson = JSON.stringify(specArr ?? []);
            row.dataset.specsJsonSnapshot = JSON.stringify(specArr ?? []);
            row.style.display = "flex";
            row.style.flexDirection = "column";
            row.style.width = "100%";
            row.style.marginBottom = "4px";
            row.style.borderBottom = "1px solid #333";

            // Head row: title (left) + controls (right)
            const head = document.createElement("div");
            head.className = "base-skill-head";
            head.style.display = "flex";
            head.style.justifyContent = "space-between";
            head.style.alignItems = "center";
            head.style.gap = "8px";

            const title = document.createElement("div");
            title.className = "base-skill-title";
            title.textContent = skillName;
            head.appendChild(title);

            const right = document.createElement("div");
            right.className = "base-skill-controls";
            right.style.display = "flex";
            right.style.alignItems = "center";
            right.style.gap = "5px";
            right.style.flex = "0 0 auto";
            right.innerHTML = `
                <span class="skill-level" style="font-weight:bold; color:#fff;">${displayLevel}</span>
                <button type="button" class="dim-btn" data-cost="1" style="font-size:0.7em; padding:2px;">-1</button>
                <button type="button" class="dim-btn" data-cost="2" style="font-size:0.7em; padding:2px;">-2</button>
            `;

            head.appendChild(right);
            row.appendChild(head);

            // Specs row (optional)
            const specsWrap = document.createElement("div");
            specsWrap.className = "cops-specs-wrap";
            specsWrap.style.fontSize = "0.85em";
            specsWrap.style.color = "#aaa";
            specsWrap.style.marginTop = "2px";
            if (specArr?.length) {
                row.dataset.specPrimary = String(specArr[0]?.spec ?? "");
                specsWrap.innerHTML = specArr
                    .map(s => `• ${s.spec} : <span style="color:#fff;">${s.level}</span>`)
                    .join("<br>");
            } else {
                specsWrap.innerHTML = "";
            }
            row.appendChild(specsWrap);

            baseList.appendChild(row);
        };

        const rerenderTrainingSnapshot = async () => {
            baseList.innerHTML = "";
            if (boughtList) boughtList.innerHTML = "";

            const state = await buildPreTrainingState();
            const baseLv = state.base.levels;
            const baseSpecs = state.base.specs;
            const histLv = state.history.levels;
            const histSpecs = state.history.specs;

            // helper: niveau général affiché (si spé, on affiche palier+1)
            const computeDisplayLevel = async (name, actualLevel, specArr) => {
                if (!specArr || specArr.length === 0) return actualLevel;
                const cfg = await Skills.getSkillConfig(name);
                const at = Number(cfg?.specialisationAt ?? 0);
	                // UX : si la compétence est "spécialisée d'office" (palier 9+ comme Connaissance),
	                // on n'affiche pas de valeur générale (la lecture se fait via les spécialisations).
	                if (at >= 9) return "—";
	                if (at > 0) return at + 1;
	                return actualLevel;
            };

            // Starter kit
            for (const s of STARTER_SKILLS) {
                const actual = baseLv.get(s.name) ?? s.niveau;
                const specArr = baseSpecs.get(s.name) ?? [];
                const display = await computeDisplayLevel(s.name, actual, specArr);
                renderBaseRow(s.name, display, actual, specArr);
            }

            // Corps à corps (toujours)
            {
                const actual = baseLv.get("Corps à corps") ?? 7;
                const specArr = baseSpecs.get("Corps à corps") ?? [];
                const display = await computeDisplayLevel("Corps à corps", actual, specArr);
                renderBaseRow("Corps à corps", display, actual, specArr);
            }

            // Social (si choisi)
            const socialName = getSocialName();
            if (socialName) {
                const actual = baseLv.get(socialName) ?? 7;
                renderBaseRow(socialName, actual, actual, []);
            }

            // Historique : compétences hors starter set (colonne Achat)
            this._copsTrainingHistoryNames = new Set();

            const renderHistoryRow = async (skillName, actualLevel, specArr = []) => {
                this._copsTrainingHistoryNames.add(skillName);

                const displayLevel = await computeDisplayLevel(skillName, actualLevel, specArr);

                const row = document.createElement("div");
                row.className = "history-skill-row";
                row.dataset.name = skillName;
                row.dataset.baseLevel = String(displayLevel);
                row.dataset.baseLevelActual = String(actualLevel);
                row.dataset.baseLevelAfterTraining = "";
                row.dataset.specsJson = JSON.stringify(specArr ?? []);
                row.dataset.specsJsonSnapshot = JSON.stringify(specArr ?? []);
                row.dataset.fromHistory = "1";
                row.style.display = "flex";
                row.style.flexDirection = "column";
                row.style.width = "100%";
                row.style.marginBottom = "4px";
                row.style.borderBottom = "1px solid #333";

                const head = document.createElement("div");
                head.className = "history-skill-head";
                head.style.display = "flex";
                head.style.justifyContent = "space-between";
                head.style.alignItems = "center";
                head.style.gap = "8px";

                const title = document.createElement("div");
                title.textContent = `${skillName}`;
                head.appendChild(title);

                const right = document.createElement("div");
                right.style.display = "flex";
                right.style.alignItems = "center";
                right.style.gap = "5px";
                right.innerHTML = `
                    <span class="skill-level" style="font-weight:bold; color:#fff;">${displayLevel}</span>
                    <button type="button" class="dim-btn" data-cost="1" style="font-size:0.7em; padding:2px;">-1</button>
                    <button type="button" class="dim-btn" data-cost="2" style="font-size:0.7em; padding:2px;">-2</button>
                `;
                head.appendChild(right);
                row.appendChild(head);

                const specsWrap = document.createElement("div");
                specsWrap.className = "cops-specs-wrap";
                specsWrap.style.fontSize = "0.85em";
                specsWrap.style.color = "#aaa";
                specsWrap.style.marginTop = "2px";
                if (specArr?.length) {
                    row.dataset.specPrimary = String(specArr[0]?.spec ?? "");
                    specsWrap.innerHTML = specArr
                        .map(s => `• ${s.spec} : <span style="color:#fff;">${s.level}</span>`)
                        .join("<br>");
                } else {
                    specsWrap.innerHTML = "";
                }
                row.appendChild(specsWrap);

                boughtList.appendChild(row);
            };

            for (const [name, lvl] of histLv.entries()) {
                const specArr = histSpecs.get(name) ?? [];
                await renderHistoryRow(name, lvl, specArr);
            }
        };

        // Rend 1ère fois + on expose un hook "enter training" pour recalcul si on revient en arrière.
        rerenderTrainingSnapshot();

        // À chaque entrée sur l’étape Training, on recalcule + on reset le budget/achats (car un retour en arrière peut changer l’Historique)
        onEnterTraining = async () => {
            try { clearPending(); } catch(e) {}
            try { resetTraining(); } catch(e) {}
            try { await rerenderTrainingSnapshot(); } catch(e) {}
        };

        // Si le joueur change le choix social / la spé Corps à corps en Étape 2, on reflète dans la colonne Base
        html.querySelectorAll("input[name='socialSkill']").forEach(r => r.addEventListener("change", () => rerenderTrainingSnapshot()));
        html.querySelectorAll("input[name='cacSpec']").forEach(r => r.addEventListener("change", () => rerenderTrainingSnapshot()));

        // Si le joueur change l'Historique (bonus éducation, choix de spé), on doit aussi recalculer
        
        // --- Training: améliorations sur le kit de base via -1 / -2 (avec pending spé) ---
        // Règles :
        // - une seule action pending à la fois
        // - amélioration = niveau -1 / -2 (sans jamais passer < 5)
        // - si palier de spécialisation atteint/dépassé : choix de spé requis (pending)
        // - si compétence déjà spécialisée : le général reste bloqué (palier+1) et l'amélioration va sur une spé

        const getRowSpecs = (row) => {
            try { return JSON.parse(String(row.dataset.specsJson ?? "[]")); }
            catch(e) { return []; }
        };

        const setRowSpecs = (row, specs) => {
            row.dataset.specsJson = JSON.stringify(specs ?? []);
            // met à jour la "spé principale" pour la finalisation si besoin
            row.dataset.specPrimary = String((specs?.[0]?.spec ?? row.dataset.specPrimary ?? "")).trim();
            // Update the dedicated specs container without touching layout of controls
            const wrap = row.querySelector(".cops-specs-wrap");
            if (!wrap) return;
            if (specs && specs.length) {
                wrap.innerHTML = specs.map(s => `• ${s.spec} : <span style="color:#fff;">${s.level}</span>`).join("<br>");
            } else {
                wrap.innerHTML = "";
            }
        };

        const updateBudget = (delta) => {
            currentBudget += delta;
            if (budgetDisplay) budgetDisplay.textContent = String(currentBudget);
        };

	    // Règle : sur les 10 points d'Entraînement, maximum 5 peuvent être dépensés sur le kit de base
	    const STARTER_SPEND_LIMIT = 5;
	    const getStarterSpent = () => {
	        let spent = 0;
	        baseList?.querySelectorAll(".base-skill-row")?.forEach(r => {
	            spent += Number(r.dataset.trainingDimCost ?? 0);
	        });
	        return spent;
	    };

        const clearDimOnRow = (row) => {
            // retire l'état actif
            row.querySelectorAll(".dim-btn").forEach(b => b.classList.remove("active"));
            // restaure niveau affiché au display de base (UX)
            const span = row.querySelector(".skill-level");
            if (span) span.textContent = String(row.dataset.baseLevel ?? span.textContent);
            // restaure les specs du snapshot (si on les avait modifiées en UI)
            const snap = (() => { try { return JSON.parse(String(row.dataset.specsJsonSnapshot ?? "[]")); } catch(e){ return []; }})();
            setRowSpecs(row, snap);
            // purge datasets training
            ["trainingDimCost","trainingDimGeneralDelta","trainingDimSpec","trainingDimSpecBoost","trainingDimSpecCreate","trainingDimRemaining","trainingDimGeneralReduction"].forEach(k => delete row.dataset[k]);
            // retire picker si présent
            row.querySelectorAll(".cops-spec-picker").forEach(n => n.remove());
        };

        const openSpecChoiceForDim = async (row, cfg, { cost, remaining, modeAlreadySpec }) => {
            // pending structure
            setPending({ kind: "dim", skill: row.dataset.name, cost, remaining });

            const skillName = row.dataset.name;
            const specs = getRowSpecs(row);
            const existingNames = specs.map(s => s.spec);

            // on rend un picker spécial : existing OU new
            row.querySelectorAll(".cops-spec-picker").forEach(n => n.remove());

            const wrap = document.createElement("div");
            wrap.className = "cops-spec-picker";
            wrap.style.margin = "6px 0 8px 0";
            wrap.style.padding = "8px";
            wrap.style.border = "1px dashed #666";
            wrap.style.borderRadius = "6px";
            wrap.style.background = "rgba(0,0,0,0.25)";

            const title = document.createElement("div");
            title.style.fontSize = "0.9em";
            title.style.marginBottom = "6px";
            title.innerHTML = `<strong>Spécialisation requise</strong> (palier ${cfg.specialisationAt})`;
            wrap.appendChild(title);

            const selectMode = document.createElement("select");
            selectMode.style.width = "100%";
            const opt0 = document.createElement("option");
            opt0.value = "";
            opt0.textContent = "— Choisir une spécialisation —";
            selectMode.appendChild(opt0);

            // existing specs
            for (const s of existingNames) {
                const o = document.createElement("option");
                o.value = `existing:${s}`;
                o.textContent = `Améliorer : ${s}`;
                selectMode.appendChild(o);
            }
            const oNew = document.createElement("option");
            oNew.value = "new";
            oNew.textContent = "Créer une nouvelle spécialisation";
            selectMode.appendChild(oNew);

            wrap.appendChild(selectMode);

            let inputNew = null;

            const renderNewInput = () => {
                inputNew?.remove();
                inputNew = null;

                if (selectMode.value !== "new") return;

                if ((cfg.specialisationMode ?? "fixed") === "free") {
                    const inp = document.createElement("input");
                    inp.type = "text";
                    inp.placeholder = "Nouvelle spécialisation…";
                    inp.style.width = "100%";
                    inp.style.marginTop = "6px";
                    inputNew = inp;
                } else {
                    const sel = document.createElement("select");
                    sel.style.width = "100%";
                    sel.style.marginTop = "6px";
                    const z = document.createElement("option");
                    z.value = "";
                    z.textContent = "— Choisir —";
                    sel.appendChild(z);

                    const opts = (cfg.specialisationOptions ?? []).filter(o => !existingNames.includes(o));
                    opts.forEach(o => {
                        const opt = document.createElement("option");
                        opt.value = o;
                        opt.textContent = o;
                        sel.appendChild(opt);
                    });
                    inputNew = sel;
                }

                wrap.appendChild(inputNew);
            };

            selectMode.addEventListener("change", renderNewInput);

            const btnRow = document.createElement("div");
            btnRow.style.display = "flex";
            btnRow.style.gap = "8px";
            btnRow.style.marginTop = "8px";
            btnRow.style.justifyContent = "flex-end";

            const bCancel = document.createElement("button");
            bCancel.type = "button";
            bCancel.textContent = "Annuler";
            bCancel.addEventListener("click", (e) => {
                e.preventDefault();
                // annule la dim et rembourse
                clearPending();
                // désactive la dim sur la row et rembourse son coût
                const activeCost = Number(row.dataset.trainingDimCost ?? 0);
                if (activeCost) updateBudget(activeCost);
                clearDimOnRow(row);
            });

            const bOk = document.createElement("button");
            bOk.type = "button";
            bOk.textContent = "Valider";
            bOk.addEventListener("click", (e) => {
                e.preventDefault();
                const v = String(selectMode.value ?? "").trim();
                if (!v) return ui.notifications.error("Choisis une spécialisation.");

                let chosenSpec = "";
                let isNew = false;

                if (v === "new") {
                    const nv = String(inputNew?.value ?? "").trim();
                    if (!nv) return ui.notifications.error("Choisis/écris la nouvelle spécialisation.");
                    chosenSpec = nv;
                    isNew = true;
                } else if (v.startsWith("existing:")) {
                    chosenSpec = v.slice("existing:".length);
                } else {
                    return ui.notifications.error("Choix invalide.");
                }

                // commit: applique la diminution sur la spé choisie selon les règles validées
                const at = Number(cfg.specialisationAt ?? 0);
                const minLevel = 5;

                let newSpecs = [...specs];
                const idx = newSpecs.findIndex(s => s.spec === chosenSpec);

                // IMPORTANT:
                // - Cas "déjà spécialisée" :
                //    - existing => la spé descend de cost
                //    - new => la nouvelle spé démarre au palier et "consomme" 1 pt pour être créée,
                //            donc la baisse appliquée = max(0, cost-1)
                // - Cas "pas encore spécialisée" (palier atteint par diminution) :
                //    - la spé est exigée et démarre au palier (on ne re-diminue pas sous le palier par ce mécanisme)

                const alreadySpec = (specs?.length ?? 0) > 0;
                let startLevel = at;
                let applyDown = 0;

                if (!alreadySpec) {
                    // Première spécialisation déclenchée par palier => valeur = palier
                    startLevel = at;
                    applyDown = 0;
                } else {
                    if (idx >= 0) {
                        // améliore une spé existante
                        startLevel = Number(newSpecs[idx].level ?? at);
                        applyDown = cost;
                    } else {
                        // nouvelle spé sur une compétence déjà spécialisée
                        startLevel = at;
                        applyDown = Math.max(0, cost - 1);
                    }
                }

                const nextLevel = startLevel - applyDown;
                if (nextLevel < minLevel) {
                    return ui.notifications.error("Impossible de descendre une spécialisation sous 5.");
                }

                if (idx >= 0) newSpecs[idx] = { spec: chosenSpec, level: nextLevel };
                else newSpecs.push({ spec: chosenSpec, level: nextLevel });

                setRowSpecs(row, newSpecs);
                row.dataset.trainingDimSpec = chosenSpec;
                // combien de niveaux ont effectivement été retirés de la spécialisation ciblée
                row.dataset.trainingDimSpecBoost = String(applyDown);
                row.dataset.trainingDimSpecCreate = isNew ? "1" : "0";

                clearPending();
                // ferme le picker + verrou visuel : on garde la dim active
                wrap.remove();
            });

            btnRow.appendChild(bCancel);
            btnRow.appendChild(bOk);
            wrap.appendChild(btnRow);

            row.appendChild(wrap);
        };

        // Délégation de clics sur les boutons -1 / -2
        baseList?.addEventListener("click", async (ev) => {
            const btn = ev.target?.closest?.(".dim-btn");
            if (!btn) return;

            ev.preventDefault();

            const row = btn.closest(".base-skill-row");
            if (!row) return;

            const cost = Number(btn.dataset.cost ?? 0);
            if (!cost) return;

            // si une action pending est en cours, on bloque
            if (blockIfPending()) return;

            // toggle off si déjà active (même cost)
            const activeCost = Number(row.dataset.trainingDimCost ?? 0);
            const isActiveThis = btn.classList.contains("active");

            if (isActiveThis) {
                // annulation
	                // retire immédiatement l'état visuel (sans nécessiter un clic ailleurs)
	                row.querySelectorAll(".dim-btn").forEach(b => b.classList.remove("active"));
	                // retire le focus pour éviter tout style résiduel
	                btn.blur?.();
                row.dataset.trainingDimCost = "";
                // remboursement
                updateBudget(cost);
                // reset row display/specs
                clearDimOnRow(row);
	                // force un reflow pour refléter l'état CSS immédiatement
	                void row.offsetHeight;
                return;
            }

            // si l'autre bouton est actif, on l'enlève d'abord
            row.querySelectorAll(".dim-btn.active").forEach(b => {
                const c = Number(b.dataset.cost ?? 0);
                b.classList.remove("active");
                if (c) updateBudget(c); // refund
            });
            clearDimOnRow(row);

	            // Règle : max 5 points dépensés sur les compétences du kit de base
	            const starterSpentNow = getStarterSpent();
	            if (starterSpentNow + cost > STARTER_SPEND_LIMIT) {
	                ui.notifications.warn(`Maximum ${STARTER_SPEND_LIMIT} points dépensés sur les compétences de base.`);
	                return;
	            }

	            // prépare la nouvelle dim (on valide d'abord que ça ne passe pas sous 5)
            const skillName = row.dataset.name;
            const span = row.querySelector(".skill-level");
            const baseActual = Number(row.dataset.baseLevelActual ?? span?.textContent ?? 10);
            const specs = getRowSpecs(row);

            const cfg = await Skills.getSkillConfig(skillName);
            const at = Number(cfg?.specialisationAt ?? 0);

            const minLevel = 5;

            // Compétence sans palier => baisse du général directe
            if (!at) {
                if (baseActual - cost < minLevel) {
                    ui.notifications.warn("Impossible de diminuer en dessous de 5.");
                    return;
                }
            }

            // Budget
            if (currentBudget - cost < 0) {
                ui.notifications.error("Budget Compétences dépassé !");
                return;
            }

            // Active
            btn.classList.add("active");
            row.dataset.trainingDimCost = String(cost);
            updateBudget(-cost);

            // Compétence sans palier => améliore le général directement
            if (!at) {
                const next = Math.max(minLevel, baseActual - cost);
                row.dataset.baseLevelAfterTraining = String(next);
                if (span) span.textContent = String(next);
                row.dataset.trainingDimGeneralDelta = String(cost);
                return;
            }

            const generalFloor = at + 1; // niveau minimal du général sans passer par une spé
            const alreadySpec = specs && specs.length > 0;

            if (alreadySpec) {
                // Cas A : déjà spécialisée => général ne bouge pas, toute l'amélioration va sur une spé (existing ou new)
                row.dataset.trainingDimRemaining = String(cost);
                if (span) span.textContent = String(row.dataset.baseLevel ?? generalFloor);
                await openSpecChoiceForDim(row, cfg, { cost, remaining: cost, modeAlreadySpec: true });
                return;
            }

            // Cas B/C : pas encore spé, on améliore le général jusqu'au plancher, puis le reste va sur une spé
            const canReduceGeneral = Math.max(0, baseActual - generalFloor);
            const generalReduction = Math.min(cost, canReduceGeneral);
            const remaining = cost - generalReduction;

            const nextGeneral = Math.max(minLevel, baseActual - generalReduction);

            // Affichage du général : si remaining > 0, on affiche le général bloqué au plancher (palier+1)
            const displayGeneral = (remaining > 0) ? generalFloor : nextGeneral;

            row.dataset.trainingDimGeneralReduction = String(generalReduction);
            row.dataset.trainingDimRemaining = String(remaining);
            row.dataset.baseLevelAfterTraining = String((remaining > 0) ? generalFloor : nextGeneral);

            if (span) span.textContent = String(displayGeneral);

            if (remaining > 0) {
                await openSpecChoiceForDim(row, cfg, { cost, remaining, modeAlreadySpec: false });
            }
        });


        // Diminutions -1/-2 sur les compétences HORS kit acquises via Historique (colonne Achat)
        // Règle : autorisé uniquement si row.dataset.fromHistory === "1" (donc pas pour les achats Training).
        boughtList?.addEventListener("click", async (ev) => {
            const btn = ev.target?.closest?.(".dim-btn");
            if (!btn) return;
            ev.preventDefault();

            const row = btn.closest(".history-skill-row");
            if (!row || row.dataset.fromHistory !== "1") return;

            const cost = Number(btn.dataset.cost ?? 0);
            if (!cost) return;

            // si une action pending est en cours, on bloque
            if (blockIfPending()) return;

            // toggle off si déjà active (même cost)
            const isActiveThis = btn.classList.contains("active");
            if (isActiveThis) {
                row.querySelectorAll(".dim-btn").forEach(b => b.classList.remove("active"));
                btn.blur?.();
                row.dataset.trainingDimCost = "";
                updateBudget(cost);
                clearDimOnRow(row);
                void row.offsetHeight;
                return;
            }

            // si l'autre bouton est actif, on l'enlève d'abord
            row.querySelectorAll(".dim-btn.active").forEach(b => {
                const c = Number(b.dataset.cost ?? 0);
                b.classList.remove("active");
                if (c) updateBudget(c);
            });
            clearDimOnRow(row);

            const skillName = row.dataset.name;
            const span = row.querySelector(".skill-level");
            const baseActual = Number(row.dataset.baseLevelActual ?? span?.textContent ?? 10);
            const specs = getRowSpecs(row);

            const cfg = await Skills.getSkillConfig(skillName);
            const at = Number(cfg?.specialisationAt ?? 0);
            const minLevel = 5;

            if (!at) {
                if (baseActual - cost < minLevel) {
                    ui.notifications.warn("Impossible de diminuer en dessous de 5.");
                    return;
                }
            }

            if (currentBudget - cost < 0) {
                ui.notifications.error("Budget Compétences dépassé !");
                return;
            }

            btn.classList.add("active");
            row.dataset.trainingDimCost = String(cost);
            updateBudget(-cost);

            if (!at) {
                const next = Math.max(minLevel, baseActual - cost);
                row.dataset.baseLevelAfterTraining = String(next);
                if (span) span.textContent = String(next);
                row.dataset.trainingDimGeneralDelta = String(cost);
                return;
            }

            const generalFloor = at + 1;
            const alreadySpec = specs && specs.length > 0;

            if (alreadySpec) {
                row.dataset.trainingDimRemaining = String(cost);
                if (span) span.textContent = String(row.dataset.baseLevel ?? generalFloor);
                await openSpecChoiceForDim(row, cfg, { cost, remaining: cost, modeAlreadySpec: true });
                return;
            }

            const canReduceGeneral = Math.max(0, baseActual - generalFloor);
            const generalReduction = Math.min(cost, canReduceGeneral);
            const remaining = cost - generalReduction;
            const nextGeneral = Math.max(minLevel, baseActual - generalReduction);
            const displayGeneral = (remaining > 0) ? generalFloor : nextGeneral;

            row.dataset.trainingDimGeneralReduction = String(generalReduction);
            row.dataset.trainingDimRemaining = String(remaining);
            row.dataset.baseLevelAfterTraining = String((remaining > 0) ? generalFloor : nextGeneral);

            if (span) span.textContent = String(displayGeneral);
            if (remaining > 0) {
                await openSpecChoiceForDim(row, cfg, { cost, remaining, modeAlreadySpec: false });
            }
        });



        ["#edu-bonus-1", "#edu-bonus-2"].forEach(sel => {
            html.querySelector(sel)?.addEventListener("change", () => rerenderTrainingSnapshot());
        });


        html.querySelector("[data-action='openCompendium']").addEventListener("click", () => game.packs.get("cops.competences").render(true));

        const dropZones = html.querySelectorAll(".drop-zone");
        dropZones.forEach(zone => {
            zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("hover"); });
            zone.addEventListener("dragleave", (e) => zone.classList.remove("hover"));
            zone.addEventListener("drop", async (e) => {
                e.preventDefault(); zone.classList.remove("hover");
                if (blockIfPending()) return;
                const cost = parseInt(zone.dataset.cost);
                const level = parseInt(zone.dataset.level);
                if (currentBudget < cost) return ui.notifications.warn("Budget insuffisant !");

                const data = TextEditor.getDragEventData(e);
                if (data.type !== "Item") return;
                const item = await Item.implementation.fromDropData(data);
                if (item.type !== "competence" && item.type !== "skill") return ui.notifications.warn("Ce n'est pas une compétence.");

                // SÉCURITÉS ANTI-DOUBLONS MAXIMALES
                if(STARTER_SKILLS.some(s => s.name === item.name)) return ui.notifications.warn("Déjà dans le Kit de Base.");
                
                const socialChosen = html.querySelector("input[name='socialSkill']:checked").value;
                if(item.name === socialChosen) return ui.notifications.warn("Déjà choisi comme compétence sociale.");
                
                // Vérif Historique (Éducation) -> Sécurité dynamique ajoutée
                const edu1 = html.querySelector("#edu-bonus-1").value;
                const edu2 = html.querySelector("#edu-bonus-2").value;
                if(item.name === edu1 || item.name === edu2) return ui.notifications.warn("Déjà acquis via l'Éducation (Historique).");

                // Vérif Historique (général) -> compétences hors kit déjà acquises
                if (this._copsTrainingHistoryNames?.has?.(item.name)) {
                    return ui.notifications.warn("Déjà acquis via l'Historique.");
                }

                // Vérif Achat précédent
                let alreadyBought = false;
                html.querySelectorAll(".bought-skill-row").forEach(r => { if(r.dataset.name === item.name) alreadyBought = true; });
                if(alreadyBought) return ui.notifications.warn("Vous avez déjà acheté cette compétence.");

                currentBudget -= cost;
                budgetDisplay.textContent = currentBudget;

                const div = document.createElement("div");
                div.className = "bought-skill-row";
                div.dataset.name = item.name;
                div.dataset.cost = cost; 
                div.style.marginBottom = "3px";
                div.style.display = "flex"; div.style.justifyContent="space-between"; div.style.alignItems="center";
                div.innerHTML = `<span><i class="fas fa-check-circle" style="color:#4f4;"></i> ${item.name} (Niv ${level})</span><i class="fas fa-trash trash-btn" style="cursor:pointer; color:#d44;" title="Rembourser"></i>`;

// --- Spécialisation requise ? (Training / achat)
// Si oui : on met l'action en pending et on demande le choix avant de continuer.
const cfgNeed = await needsSpecNow(item.name, level);
if (cfgNeed) {
    setPending({ kind: "buy", skill: item.name });

    renderSpecPicker(div, cfgNeed, {
        onConfirm: (picked) => {
            // stocke sur la row (sera lu au finish)
            div.dataset.spec = picked;

            // feedback visuel minimal
            const label = document.createElement("div");
            label.className = "cops-spec-picked";
            label.style.fontSize = "0.8em";
            label.style.color = "#ffcc00";
            label.style.marginTop = "4px";
            label.textContent = `Spé : ${picked}`;
            // évite doublon
            div.querySelectorAll(".cops-spec-picked").forEach(n => n.remove());
            div.appendChild(label);

            // retire le picker et libère
            div.querySelectorAll(".cops-spec-picker").forEach(n => n.remove());
            clearPending();
        },
        onCancel: () => {
            // Annule l'achat : on retire la row + on rembourse
            try { div.remove(); } catch(e) {}
            currentBudget += cost;
            budgetDisplay.textContent = currentBudget;
            clearPending();
        }
    });
}


                
                div.querySelector(".trash-btn").addEventListener("click", () => {
                    div.remove();
                    currentBudget += cost;
                    budgetDisplay.textContent = currentBudget;
                });
                boughtList.appendChild(div);
            });
        });
    }
}