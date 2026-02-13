const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class DetectiveSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    
    constructor(options) {
        super(options);
        this.currentTab = "competences";
        this._expandedSkills = new Set();
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["cops", "sheet", "actor", "detective"],
        position: { width: 900, height: 850 },
        window: { resizable: true },
        form: { submitOnChange: true, closeOnSubmit: false },
        tabs: {
            primary: {
                group: "primary",
                navSelector: ".sheet-tabs",
                contentSelector: ".sheet-body",
                initial: "competences"
            }
        }
    };

    static PARTS = {
        form: { template: "systems/cops/templates/detective-sheet.html" }
    };

    async _learnSkillFromCompendium() {
        const actor = this.document;
        const cost = 5;

        if (actor.system.ressources.xp < cost) {
            return ui.notifications.warn(`Pas assez d'XP (${cost} requis)`);
        }

        const packId = "cops.competences";
        const pack = game.packs.get(packId);
        if (!pack) return ui.notifications.error("Compendium des compétences introuvable.");

        await pack.getIndex();

        // Compétences déjà connues (anti-doublon strict)
        const owned = new Set(
            actor.items
            .filter(i => i.type === "skill" || i.type === "competence")
            .map(i => i.name.trim().toLowerCase())
        );

        const available = pack.index
            .filter(e =>
            (e.type === "skill" || e.type === "competence") &&
            !owned.has(e.name.trim().toLowerCase())
            )
            .sort((a, b) => a.name.localeCompare(b.name, "fr"));

        if (!available.length) {
            return ui.notifications.warn("Toutes les compétences disponibles sont déjà connues.");
        }

        const optionsHtml = available.map(e =>
            `<option value="${e._id}" style="color:#000;">${e.name}</option>`
        ).join("");

        const content = `
            <div class="form-group">
            <label>Choisir une compétence</label>
            <select name="skillId" style="width:100%; color:#000; background:#eee;">
                ${optionsHtml}
            </select>
            </div>
            <p style="margin-top:8px; opacity:0.8;">Coût : <strong>${cost} XP</strong></p>
        `;

        const chosenId = await new Promise(resolve => {
            new Dialog({
            title: "Apprendre une compétence",
            content,
            buttons: {
                ok: { label: "Apprendre", callback: html => resolve(html.find('[name="skillId"]').val()) },
                cancel: { label: "Annuler", callback: () => resolve(null) }
            },
            default: "ok"
            }).render(true);
        });

        if (!chosenId) return;

        const source = await pack.getDocument(chosenId);
        if (!source) return;

        const data = source.toObject();
        data.system = data.system ?? {};
        data.system.niveau = 9;

        const [created] = await actor.createEmbeddedDocuments("Item", [data]);
        if (!created) return;

        await actor.update({
            "system.ressources.xp": actor.system.ressources.xp - cost
        });

        // --- CAS 9+ : spécialisation obligatoire immédiate ---
        const specAt = Number(created.system.specialisationAt ?? 0);
        if (specAt === 9) {
            const mode = created.system.specialisationMode ?? "fixed";
            const options = created.system.specialisationOptions ?? [];
            const specs = {};

            const chosenSpec = await this._promptChooseSpec(created, mode, options, specs);
            if (!chosenSpec) {
            await created.delete();
            await actor.update({
                "system.ressources.xp": actor.system.ressources.xp + cost
            });
            return ui.notifications.warn("Acquisition annulée (spécialisation obligatoire).");
            }

            specs[chosenSpec] = 9;
            await created.update({ "system.specialisations": specs });
        }

        ui.notifications.info(`${created.name} apprise ! (-${cost} XP)`);
    }


    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        
        context.actor = this.document;
        context.system = this.document.system;
        context.items = this.document.items;

        // Required by templates (e.g. rich-text editors)
        context.owner = this.document.isOwner;
        context.editable = this.isEditable;

        context.tabs = { primary: this.currentTab };

        context.config = {
            attitudes: {
                "standard": "Standard",
                "ultra": "Ultra-Violent (+2 Init)",
                "agressif": "Agressif (+1 Init)",
                "prudent": "Prudent (-1 Init)",
                "planque": "Planqué (-2 Init)"
            }
        };

        context.skills = context.items.filter(i => i.type === "competence" || i.type === "skill").sort((a, b) => a.name.localeCompare(b.name));
        context.skillsView = context.skills.map((item) => {
            const specAt = Number(item.system?.specialisationAt ?? 0);
            const isSpecialisable = specAt > 0;
            const isAcquireSpecialisedOnly = specAt === 9;

            const specs = item.system?.specialisations ?? {};
            const specEntries = Object.entries(specs).sort((a, b) => a[0].localeCompare(b[0]));
            const hasSpecialisations = specEntries.length > 0;

            const lines = [];

            // Ligne "Général" uniquement si ce n’est pas un cas 9+ (spécialisé obligatoire)
            if (!isAcquireSpecialisedOnly) {
                lines.push({
                kind: "base",
                key: "base",
                label: "Général",
                niveau: item.system.niveau
                });
            }

            // Lignes spécialisées existantes
            for (const [key, niveau] of specEntries) {
                lines.push({
                kind: "spec",
                key,
                label: key,
                niveau
                });
            }

            return {
                item,
                view: {
                specialisationAt: specAt,
                isSpecialisable,
                isAcquireSpecialisedOnly,
                hasSpecialisations,
                specCount: specEntries.length,
                isExpanded: this._expandedSkills.has(item.id),
                lines
                }
            };
            });
        context.armes = context.items.filter(i => i.type === "arme" || i.type === "weapon");
        context.protections = context.items.filter(i => i.type === "protection" || i.type === "armor");
        context.materiel = context.items.filter(i => i.type === "materiel" || i.type === "gear");
        context.stages = context.items.filter(i => i.type === "stage");
        context.contacts = context.items.filter(i => i.type === "contact");
        context.favorites = context.items.filter(i => i.system.isFavorite === true);

        context.caracsDisplay = {};
        for (let [key, carac] of Object.entries(context.system.caracteristiques)) {
            context.caracsDisplay[key] = {
                key: key,
                value: carac.value,
                hasBlue: carac.hasBlue,
                label: key.charAt(0).toUpperCase() + key.slice(1)
            };
        }

        context.isTerre = (context.system.combat.etat === "terre");
        context.isChoc = (context.system.combat.etat === "choc");

        // Pre-rendered HTML used for read-only display
        context.enrichedBio = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.biographie,
            { secrets: this.document.isOwner }
        );

        context.isGM = game.user.isGM;

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
    // --- GESTION DE L'IMAGE DE PROFIL ---
        const img = html.querySelector(".profile-img");
        if (img && this.isEditable) {
            img.addEventListener("click", ev => this._onEditImage(ev));
        }
        // --- GESTION MANUELLE DES ONGLETS (V2) ---
        html.querySelectorAll(".sheet-tabs .item").forEach(tab => {
            tab.addEventListener("click", (ev) => {
                ev.preventDefault();
                const tabName = ev.currentTarget.dataset.tab;
                this.currentTab = tabName;
                html.querySelectorAll(".sheet-tabs .item").forEach(t => t.classList.remove("active"));
                ev.currentTarget.classList.add("active");
                html.querySelectorAll(".sheet-body .tab").forEach(page => {
                    page.classList.remove("active");
                    if (page.dataset.tab === tabName) page.classList.add("active");
                });
            });
        });

        // Listeners Actions
        html.querySelectorAll("[data-action]").forEach(el => {
            el.addEventListener("click", (ev) => this._handleAction(ev));
        });

            // Inputs directs (MJ uniquement, avec garde-fous spécialisation)
        html.querySelectorAll(".skill-input-direct").forEach(input => {
        input.addEventListener("change", async (ev) => {
            if (!game.user.isGM) return;

            const card = ev.currentTarget.closest(".skill-card");
            if (!card) return;

            const itemId = card.dataset.itemId;
            const item = this.document.items.get(itemId);
            if (!item) return;

            const rawValue = Number(ev.target.value);
            if (!Number.isFinite(rawValue)) {
                ev.target.value = item.system.niveau;
                return;
            }

            const specAt = Number(item.system.specialisationAt ?? 0);
            const specs = item.system.specialisations ?? {};
            const hasSpecs = Object.keys(specs).length > 0;

            // Minimum absolu = 2
            let finalValue = Math.max(2, rawValue);

            // Cas 9+ : pas de Général éditable
            if (specAt === 9) {
                ui.notifications.warn(
                    "Compétence 9+ : le niveau Général n'est pas modifiable. Utilise les spécialisations."
                );
                ev.target.value = item.system.niveau;
                return;
            }

            // Compétence spécialisable, aucune spé encore :
            // le Général doit rester STRICTEMENT au-dessus du palier
            if (specAt > 0 && !hasSpecs && finalValue <= specAt) {
                ui.notifications.warn(
                    `À partir du palier ${specAt}, il faut choisir une spécialisation.`
                );
                ev.target.value = item.system.niveau;
                return;
            }

            // Compétence avec spé existante : Général bloqué
            if (specAt > 0 && hasSpecs) {
                ui.notifications.warn(
                    "Le niveau Général est bloqué : modifie les spécialisations (↑ / ⚙)."
                );
                ev.target.value = item.system.niveau;
                return;
            }

            // Update autorisé
            await item.update({ "system.niveau": finalValue });
            ev.target.value = finalValue;
            });
        });

        
        // --- SECURITE ADRENALINE / ANCIENNETE (Total Max 5) ---
        const enforceRuleOf5 = (ev, type) => {
             const newVal = parseInt(ev.target.value);
             const otherVal = type === "adr" ? this.document.system.ressources.anciennete : this.document.system.ressources.adrenaline.value;
             if ((newVal + otherVal) > 5) {
                 ui.notifications.warn("Le total Adrénaline + Ancienneté ne peut pas dépasser 5 !");
                 ev.target.value = type === "adr" ? this.document.system.ressources.adrenaline.value : this.document.system.ressources.anciennete;
                 return;
             }
             const path = type === "adr" ? "system.ressources.adrenaline.value" : "system.ressources.anciennete";
             this.document.update({[path]: newVal});
        };

        html.querySelectorAll(".adrenaline-input").forEach(input => input.addEventListener("change", (ev) => enforceRuleOf5(ev, "adr")));
        html.querySelectorAll(".anciennete-input").forEach(input => input.addEventListener("change", (ev) => enforceRuleOf5(ev, "anc")));

                // --- SAUVEGARDE PROSEMIRROR (SheetV2) ---
        html.querySelectorAll("prose-mirror[name]").forEach(pm => {
        if (pm.dataset.pmBound) return;
        pm.dataset.pmBound = "1";

        pm.addEventListener("save", async () => {
            const path = pm.getAttribute("name");          // ex: "system.biographie"
            const value = pm.value ?? "";                  // valeur éditée

            await this.document.update({ [path]: value });
            // Optionnel: re-render pour mettre à jour l'affichage enrichi si tu l'affiches ailleurs
            this.render({ force: true });
        });
        });

    }
    async _onEditImage(event) {
        const attr = event.currentTarget.dataset.edit;
        const current = foundry.utils.getProperty(this.document, attr);
        const fp = new FilePicker({
            type: "image",
            current: current,
            callback: path => {
                this.document.update({ [attr]: path });
            },
            top: this.position.top + 40,
            left: this.position.left + 10
        });
        return fp.browse();
    }
    async _handleAction(event) {
        event.preventDefault();
        const button = event.currentTarget;
        const action = button.dataset.action;
        const actor = this.document;

        console.log("ACTION", action);


            if (action === "toggleSkillGroup") {
            const itemId = button.closest("[data-item-id]")?.dataset?.itemId;
            if (!itemId) return;

            // 👉 un seul ouvert à la fois
            if (this._expandedSkills.has(itemId)) {
                this._expandedSkills.clear();
            } else {
                this._expandedSkills.clear();
                this._expandedSkills.add(itemId);
            }

            this.render({ force: true });
            return;
            }



            if (action === "rollSkillLine") {
            const card = button.closest("[data-item-id]");
            const itemId = card?.dataset?.itemId;
            const kind = card?.dataset?.lineKind;   // "base" | "spec"
            const specKey = card?.dataset?.specKey; // "base" ou "Voiture"
            if (!itemId) return;

            const item = actor.items.get(itemId);
            if (!item) return;

            const base = Number(item.system.niveau);
            const specs = item.system.specialisations ?? {};

            let seuil = base;
            let label = `${item.name} (Général)`;
            let tags = ["general"];

            if (kind === "spec" && specKey && specKey !== "base") {
                seuil = Number(specs[specKey] ?? base);
                label = `${item.name} (${specKey})`;
                tags = ["spec", specKey.toLowerCase()];
            }

            // On réutilise ton jet standard, mais en forçant le seuil + le nom affiché
            await item.rollSkill({ seuil, label, tags });
            return;
            }


        // --- GESTION DU RECHARGEMENT (NOUVEAU) ---
        if (action === "reloadWeapon") {
            const itemId = button.closest("[data-item-id]").dataset.itemId;
            const weapon = actor.items.get(itemId);
            if (!weapon) return;

            const ammoType = weapon.system.ammoType;

            // 1. Rechargement Libre (Pas de type défini)
            if (!ammoType || ammoType.trim() === "") {
                if (weapon.reload) {
                    weapon.reload(); // Utilise la méthode par défaut si elle existe
                } else {
                    // Fallback manuel si la méthode n'est pas dispo
                    await weapon.update({"system.munitions.value": weapon.system.munitions.max});
                    ui.notifications.info(`${weapon.name} rechargée (Munitions Illimitées).`);
                }
                return;
            }

            // 2. Recherche Munitions en Inventaire (Type Matériel)
            // On cherche un objet 'materiel' dont le nom correspond (insensible à la casse)
            const ammoItem = actor.items.find(i => 
                (i.type === "materiel" || i.type === "gear") && 
                i.name.toLowerCase().trim() === ammoType.toLowerCase().trim()
            );

            if (!ammoItem) {
                return ui.notifications.warn(`Rechargement impossible : Aucune munition nommée "${ammoType}" trouvée dans l'inventaire.`);
            }

            // 3. Calculs
            const current = weapon.system.munitions.value;
            const max = weapon.system.munitions.max;
            const missing = max - current;

            if (missing <= 0) return ui.notifications.info("Arme déjà chargée.");

            const available = ammoItem.system.quantite;

            if (available <= 0) return ui.notifications.warn(`Vos munitions de "${ammoType}" sont épuisées !`);

            // 4. Transaction
            let toLoad = Math.min(missing, available);
            
            await weapon.update({"system.munitions.value": current + toLoad});
            await ammoItem.update({"system.quantite": available - toLoad});

            ui.notifications.info(`Rechargement : ${toLoad} balles de ${ammoType} chargées.`);
            
            if (available - toLoad <= 0) {
                ui.notifications.warn(`Attention : Vous n'avez plus de ${ammoType} !`);
            }
            return;
        }

        if (["editItem", "deleteItem", "rollBurst", "rollWeapon", "toggleEquip", "onRollItem", "toggleFavorite", "manageSpecialisations"].includes(action)) {
            const itemId = button.closest("[data-item-id]")?.dataset.itemId;
            const item = actor.items.get(itemId);
            if (!item) return;

            if (action === "manageSpecialisations") {
                const card = button.closest("[data-item-id]");
                const itemId = card?.dataset?.itemId;
                if (!itemId) return;

                await this._manageSpecialisations(itemId);
                return;
            }

            if (action === "editItem") item.sheet.render(true);
            if (action === "deleteItem") item.delete();
            if (action === "toggleEquip") item.update({"system.equipe": !item.system.equipe});
            if (action === "toggleFavorite") item.update({"system.isFavorite": !item.system.isFavorite});
            // reloadWeapon a été traité au-dessus
            if (action === "rollWeapon") item.rollWeapon();
            if (action === "rollBurst") item.rollBurst();
            if (action === "onRollItem") item.roll();


            return;
        }

        if (action === "createItem") {
            await Item.create({name: "Nouvel Objet", type: button.dataset.type}, {parent: actor});
            return;
        }

        if (action === "rollAttribute") {
            const key = button.dataset.attr;
            const carac = actor.system.caracteristiques[key];
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            
            const content = `
                <div style="text-align:center;">
                    <h3 style="color:#00ccff;">${label}</h3>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin:5px 0;">
                        <label>Difficulté (Seuil)</label>
                        <input type="number" id="seuil" value="6" style="width:50px; text-align:center;">
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <label>Modificateur (Dés)</label>
                        <input type="number" id="mod" value="0" style="width:50px; text-align:center;">
                    </div>
                </div>`;

            await DialogV2.wait({
                window: { title: `Test de ${label}` },
                content: content,
                buttons: [{
                    action: "roll", label: "Jeter", default: true,
                    callback: async (event, button, dialog) => {
                        const seuil = parseInt(dialog.element.querySelector("#seuil").value);
                        const mod = parseInt(dialog.element.querySelector("#mod").value);
                        
                        const isChoc = actor.system.combat.etat === "choc";
                        const basePool = carac.value;
                        const finalPool = Math.max(1, basePool + mod + (isChoc ? -1 : 0));
                        const title = isChoc ? `${label} (Sous Choc -1D)` : label;

                        import("./dice.js").then(m => m.rollCops(finalPool, seuil, title, { 
                            actor: actor, blueDie: carac.hasBlue, type: "caracteristique", diff: seuil 
                        }));
                    }
                }]
            });
        }

        if (action === "toggleBlue") {
            const key = button.dataset.attr;
            if (key) {
                const current = actor.system.caracteristiques[key].hasBlue;
                await actor.update({ [`system.caracteristiques.${key}.hasBlue`]: !current });
            } else {
                const itemId = button.closest(".skill-card")?.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.update({"system.hasBlue": !item.system.hasBlue});
            }
        }

        if (action === "openSpecificCompendium") {
            const packName = button.dataset.pack;
            const pack = game.packs.get(packName);
            if (pack) pack.render(true);
            else ui.notifications.warn(`Le compendium ${packName} est introuvable.`);
        }

        if (action === "upgradeAttribute") {
            const attr = button.dataset.attr;
            const currentVal = actor.system.caracteristiques[attr].value;
            if (currentVal >= 5) return ui.notifications.warn("Maximum 5 atteint.");
            
            const cost = currentVal * 10; 
            if (actor.system.ressources.xp < cost) return ui.notifications.warn(`Pas assez d'XP (Requis: ${cost})`);

            await actor.update({
                [`system.caracteristiques.${attr}.value`]: currentVal + 1,
                "system.ressources.xp": actor.system.ressources.xp - cost
            });
            ui.notifications.info(`${attr} augmenté ! (-${cost} XP)`);
        }

        if (action === "upgradeSkillLine") {
            const card = button.closest("[data-item-id]") || button.closest(".skill-card");
            const itemId = card?.dataset?.itemId;
            const kind = button.dataset.lineKind || card?.dataset?.lineKind;     // "base" | "spec"
            const specKey = button.dataset.specKey || card?.dataset?.specKey;    // "base" | "Voiture" | etc.
            if (!itemId) return;

            const item = actor.items.get(itemId);
            if (!item) return;

            const specAt = Number(item.system.specialisationAt ?? 0);
            const mode = item.system.specialisationMode ?? "fixed";
            const options = item.system.specialisationOptions ?? [];
            const specs = foundry.utils.deepClone(item.system.specialisations ?? {});
            const hasSpecs = Object.keys(specs).length > 0;

            // Helpers coût + check XP
            const getCost = (level) => (11 - level) * 2;

            // --- UPGRADE SPECIALISATION ---
            if (kind === "spec" && specKey && specKey !== "base") {
                const current = Number(specs[specKey]);
                if (!Number.isFinite(current)) return ui.notifications.warn("Spécialisation introuvable.");
                if (current <= 1) return ui.notifications.warn("Niveau minimum 1 atteint.");

                const cost = getCost(current);
                if (actor.system.ressources.xp < cost) return ui.notifications.warn(`Pas assez d'XP (Requis: ${cost})`);

                specs[specKey] = current - 1;
                await item.update({ "system.specialisations": specs });
                await actor.update({ "system.ressources.xp": actor.system.ressources.xp - cost });
                ui.notifications.info(`${item.name} (${specKey}) amélioré ! (-${cost} XP)`);
                return;
            }

            // --- UPGRADE GENERAL ---
            const currentLevel = Number(item.system.niveau);
            if (currentLevel <= 2) {
            return ui.notifications.warn("Niveau minimum 2 atteint.");
            }

            if (specAt === 9) {
                // 9+ : le Général n'existe pas, on ajoute une spécialisation
                if (mode === "fixed") {
                    const taken = new Set(Object.keys(specs));
                    const available = (options || []).filter(o => o && !taken.has(o));
                    if (!available.length) {
                    return ui.notifications.warn("Toutes les spécialisations sont déjà acquises.");
                    }
                }

                const chosen = await this._promptChooseSpec(item, mode, options, specs);
                if (!chosen) return;

               const cost = 5;
            if (actor.system.ressources.xp < cost) {
                return ui.notifications.warn(`Pas assez d'XP (Requis: ${cost})`);
                }

                specs[chosen] = 9;
                await item.update({ "system.specialisations": specs });
                await actor.update({
                "system.ressources.xp": actor.system.ressources.xp - cost
                });

                ui.notifications.info(`${item.name} (${chosen}) ajouté à 9 ! (-${cost} XP)`);
                return;

            }


            // --- GÉNÉRAL BLOQUÉ MAIS AJOUT DE NOUVELLE SPÉ (SI POSSIBLE) ---
            if (specAt > 0 && hasSpecs) {

                // FIXED : vérifier s'il reste des spécialisations
                if (mode === "fixed") {
                    const taken = new Set(Object.keys(specs));
                    const available = (options || []).filter(o => o && !taken.has(o));
                    if (!available.length) {
                    return ui.notifications.warn("Toutes les spécialisations sont déjà acquises.");
                    }
                }

                const cost = 5;
                if (actor.system.ressources.xp < cost) {
                    return ui.notifications.warn(`Pas assez d'XP (Requis: ${cost})`);
                }

                const chosen = await this._promptChooseSpec(item, mode, options, specs);
                if (!chosen) return;

                specs[chosen] = specAt;

                await item.update({ "system.specialisations": specs });
                await actor.update({
                    "system.ressources.xp": actor.system.ressources.xp - cost
                });

                ui.notifications.info(
                    `${item.name} (${chosen}) ajouté à ${specAt} ! (-${cost} XP)`
                );
                return;
            }



            const nextLevel = currentLevel - 1;
            const cost = getCost(currentLevel);
            if (actor.system.ressources.xp < cost) return ui.notifications.warn(`Pas assez d'XP (Requis: ${cost})`);

            // Si on atteint le palier => choix obligatoire d'une spé, et le général NE descend PAS
            if (specAt > 0 && nextLevel === specAt) {
                const chosen = await this._promptChooseSpec(item, mode, options, specs);
                if (!chosen) return;

                specs[chosen] = nextLevel;

                await item.update({ "system.specialisations": specs });
                await actor.update({ "system.ressources.xp": actor.system.ressources.xp - cost });
                ui.notifications.info(`${item.name} (${chosen}) créé à ${nextLevel} ! (-${cost} XP)`);
                return;
            }

            // Sinon upgrade normal du général
            await item.update({ "system.niveau": nextLevel });
            await actor.update({ "system.ressources.xp": actor.system.ressources.xp - cost });
            ui.notifications.info(`${item.name} amélioré ! (-${cost} XP)`);
            return;
        }


       if (action === "upgradeSkill") {
    const itemId = button.closest(".skill-card").dataset.itemId;
    const item = actor.items.get(itemId);

    const currentLevel = Number(item.system.niveau);
    if (currentLevel <= 2) {
  return ui.notifications.warn("Niveau minimum 2 atteint.");
}

    const cost = (11 - currentLevel) * 2;
    if (actor.system.ressources.xp < cost)
        return ui.notifications.warn(`Pas assez d'XP (Requis: ${cost})`);

    // --- DONNÉES SPÉ ---
    const specAt = Number(item.system.specialisationAt ?? 0);
    const mode = item.system.specialisationMode ?? "fixed";
    const options = item.system.specialisationOptions ?? [];
    const specs = foundry.utils.deepClone(item.system.specialisations ?? {});
    const hasSpecs = Object.keys(specs).length > 0;

    const nextLevel = currentLevel - 1;

    // --- CAS 9+ : pas de général ---
    if (specAt === 9) {
        return ui.notifications.warn(
            "Cette compétence nécessite une spécialisation dès l’acquisition (9+)."
        );
    }

        // --- GÉNÉRAL BLOQUÉ MAIS AJOUT DE NOUVELLE SPÉ (SI POSSIBLE) ---
    if (specAt > 0 && hasSpecs) {

        // Cas FIXED : vérifier s'il reste des spécialisations disponibles
        if (mode === "fixed") {
            const taken = new Set(Object.keys(specs));
            const available = (options || []).filter(o => o && !taken.has(o));

            if (available.length === 0) {
                return ui.notifications.warn(
                    "Toutes les spécialisations sont déjà acquises."
                );
            }
        }

        const chosen = await this._promptChooseSpec(item, mode, options, specs);
        if (!chosen) return;

        // Nouvelle spécialisation créée au palier
        specs[chosen] = specAt;

        await item.update({ "system.specialisations": specs });

        ui.notifications.info(
            `${item.name} (${chosen}) ajouté à ${specAt}.`
        );
        return;
    }


    // --- PALIER ATTEINT : CRÉATION DE SPÉ ---
    if (specAt > 0 && !hasSpecs && nextLevel === specAt) {
        const chosen = await this._promptChooseSpec(item, mode, options, specs);
        if (!chosen) return; // annulation = pas d'XP dépensée

        specs[chosen] = nextLevel;

        // IMPORTANT : on NE baisse PAS le général
        await item.update({ "system.specialisations": specs });
        await actor.update({
            "system.ressources.xp": actor.system.ressources.xp - cost
        });

        ui.notifications.info(
            `${item.name} (${chosen}) créé à ${nextLevel} ! (-${cost} XP)`
        );
        return;
    }

    // --- UPGRADE NORMAL (compétence sans spé ou avant palier) ---
    await item.update({ "system.niveau": nextLevel });
    await actor.update({
        "system.ressources.xp": actor.system.ressources.xp - cost
    });

    ui.notifications.info(`${item.name} amélioré ! (-${cost} XP)`);
}


        if (action === "createSkill") {
            await this._learnSkillFromCompendium();
            return;
        }


        if (action === "buyVital") {
            const type = button.closest("[data-type]").dataset.type;
            const cost = 15;
            if (actor.system.ressources.xp < cost) return ui.notifications.warn("Pas assez d'XP (15 requis)");
            
            const currentAdr = actor.system.ressources.adrenaline.value;
            const currentAnc = actor.system.ressources.anciennete;

            if ((currentAdr + currentAnc) >= 5) {
                return ui.notifications.warn("Le total Adrénaline + Ancienneté ne peut pas dépasser 5 !");
            }

            if (type === "adrenaline") {
                const currentMax = actor.system.ressources.adrenaline.max || 0;
                await actor.update({
                    "system.ressources.adrenaline.value": currentAdr + 1, 
                    "system.ressources.adrenaline.max": currentMax + 1, 
                    "system.ressources.xp": actor.system.ressources.xp - cost
                });
            } else {
                await actor.update({"system.ressources.anciennete": currentAnc + 1, "system.ressources.xp": actor.system.ressources.xp - cost});
            }
        }
        
        if (action === "convertVital") {
            const adr = actor.system.ressources.adrenaline.value;
            const anc = actor.system.ressources.anciennete;
            if (adr < 1) return ui.notifications.warn("Pas d'adrénaline à convertir.");
            await actor.update({ "system.ressources.adrenaline.value": adr - 1, "system.ressources.anciennete": anc + 1 });
            ui.notifications.info("1 Point d'Adrénaline échangé contre 1 Ancienneté.");
        }

        // --- GESTION ACTION STAGE ---
        if (action === "useStageAction") {
            const itemId = button.closest("[data-item-id]").dataset.itemId;
            const item = actor.items.get(itemId);
            if (!item) return;

            const sys = item.system;
            const coutAdr = sys.coutAdrenaline || 0;
            const coutAnc = sys.coutAnciennete || 0;
            
            const currentAdr = actor.system.ressources.adrenaline.value;
            const currentAnc = actor.system.ressources.anciennete;

            // 1. Vérification des coûts
            if (currentAdr < coutAdr) return ui.notifications.warn(`Pas assez d'Adrénaline (Requis: ${coutAdr})`);
            if (currentAnc < coutAnc) return ui.notifications.warn(`Pas assez d'Ancienneté (Requis: ${coutAnc})`);

            // 2. Confirmation et Exécution
            const costText = [];
            if (coutAdr > 0) costText.push(`${coutAdr} Adrénaline`);
            if (coutAnc > 0) costText.push(`${coutAnc} Ancienneté`);
            const costString = costText.length > 0 ? `Coût : <strong>${costText.join(" + ")}</strong>` : "Gratuit";

            await DialogV2.wait({
                window: { title: `Action : ${item.name}` },
                content: `
                    <div style="text-align:center;">
                        <h3 style="color:#ffcc00; margin-bottom:5px;">${sys.labelAction}</h3>
                        <p style="font-size:1.1em; margin-bottom:10px;">${costString}</p>
                        <div style="text-align:left; font-style:italic; background:rgba(255,255,255,0.1); padding:8px; border-radius:4px; font-size:0.9em;">
                            ${sys.descriptionAction || "Pas de description."}
                        </div>
                    </div>
                `,
                buttons: [{
                    action: "confirm", label: "ACTIVER", icon: "fas fa-check", default:true,
                    callback: async () => {
                        // Paiement
                        if (coutAdr > 0 || coutAnc > 0) {
                            await actor.update({
                                "system.ressources.adrenaline.value": currentAdr - coutAdr,
                                "system.ressources.anciennete": currentAnc - coutAnc
                            });
                        }
                        
                        // Message Chat
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                            content: `
                                <div class="cops-chat-message">
                                    <h3 style="border-bottom:2px solid #00ccff; margin-bottom:5px;">${item.name}</h3>
                                    <div style="font-weight:bold; color:#070A42; margin-bottom:5px;">ACTION : ${sys.labelAction}</div>
                                    <div style="font-style:italic;">${sys.descriptionAction || ""}</div>
                                    <div style="margin-top:5px; font-size:0.8em; color:#aaa; border-top:1px solid #555; padding-top:2px;">${costString}</div>
                                </div>
                            `
                        });
                    }
                }]
            });
        }

        if (action === "rest") {
            const adr = actor.system.ressources.adrenaline.value;
            const anc = actor.system.ressources.anciennete;
            
            // Récupération des Max
            const maxAdr = actor.system.ressources.adrenaline.max !== undefined ? actor.system.ressources.adrenaline.max : 5;
            const maxAnc = actor.getFlag("cops", "maxAnciennete") !== undefined ? actor.getFlag("cops", "maxAnciennete") : 5;
            
            if ((adr + anc) >= 5) {
                return ui.notifications.warn("Repos impossible : Vous êtes déjà au maximum de votre potentiel global (Total 5).");
            }
            
            await DialogV2.wait({
                window: { title: "Nuit de Repos" },
                content: "<div style='text-align:center; font-size:1.1em; margin-bottom:10px;'>Vous récupérez 1 point.<br>Où voulez-vous le placer ?</div>",
                buttons: [
                    {
                        action: "adr",
                        label: "⚡ Adrénaline",
                        callback: async () => {
                            if (adr >= maxAdr) {
                                return ui.notifications.warn(`Impossible : Votre maximum d'Adrénaline est de ${maxAdr}.`);
                            }
                            await actor.update({"system.ressources.adrenaline.value": adr + 1});
                            ui.notifications.info("Repos : +1 Adrénaline");
                        }
                    },
                    {
                        action: "anc",
                        label: "🎓 Ancienneté",
                        callback: async () => {
                            if (anc >= maxAnc) {
                                return ui.notifications.warn(`Impossible : Votre maximum d'Ancienneté est de ${maxAnc}.`);
                            }
                            await actor.update({"system.ressources.anciennete": anc + 1});
                            ui.notifications.info("Repos : +1 Ancienneté");
                        }
                    }
                ]
            });
        }

        if (action === "recoverTerre") {
            actor.recoverFromTerre();
        }
    }

    async _promptChooseSpec(item, mode, options, existingSpecs = {}) {
        return new Promise((resolve) => {
            const existing = new Set(Object.keys(existingSpecs || {}));

            // Mode "free" => texte libre
            if (mode === "free") {
            new Dialog({
                title: `Choisir une spécialisation — ${item.name}`,
                content: `
                <div class="form-group">
                    <label>Nom de la spécialisation</label>
                    <input type="text" name="specName" style="width:100%" />
                </div>
                `,
                buttons: {
                ok: {
                    label: "Valider",
                    callback: (html) => {
                    const v = html.find('input[name="specName"]').val()?.toString().trim();
                    if (!v) return resolve(null);
                    if (existing.has(v)) return ui.notifications.warn("Spécialisation déjà existante.") || resolve(null);
                    resolve(v);
                    }
                },
                cancel: { label: "Annuler", callback: () => resolve(null) }
                },
                default: "ok"
            }).render(true);
            return;
            }

            // Mode "fixed" => liste
            const available = (options || []).filter(o => o && !existing.has(o));
            if (!available.length) {
            ui.notifications.warn("Aucune spécialisation disponible à ajouter.");
            return resolve(null);
            }

            const opts = available.map(
            o => `<option value="${o}" style="color:#000;">${o}</option>`
            ).join("");

            new Dialog({
            title: `Choisir une spécialisation — ${item.name}`,
            content: `
                <div class="form-group">
                <label>Spécialisation</label>
                <select name="specKey" style="width:100%; color:#000; background:#eee;">${opts}</select>
                </div>
            `,
            buttons: {
                ok: { label: "Valider", callback: (html) => resolve(html.find('select[name="specKey"]').val() || null) },
                cancel: { label: "Annuler", callback: () => resolve(null) }
            },
            default: "ok"
            }).render(true);
        });
    }

    async _manageSpecialisations(itemId) {
        if (!game.user.isGM) return;

        const actor = this.document;
        const item = actor.items.get(itemId);
        if (!item) return;

        const specAt = Number(item.system.specialisationAt ?? 0);
        const mode = item.system.specialisationMode ?? "fixed";
        const options = item.system.specialisationOptions ?? [];
        const specs = foundry.utils.deepClone(item.system.specialisations ?? {});

        // Construction du HTML
        let rows = Object.entries(specs).map(([key, value]) => `
        <div class="form-group" style="display:flex; gap:6px; align-items:center; width:100%;">
            <input type="text"
                value="${key}"
                disabled
                style="flex:1 1 auto; min-width:180px;" />

            <input type="number"
                name="level-${key}"
                value="${value}"
                min="2"
                style="width:60px; flex:0 0 auto;" />

            <button type="button"
                    class="spec-delete"
                    data-key="${key}"
                    title="Supprimer"
                    style="width:28px; height:28px; padding:0; line-height:28px; flex:0 0 auto;">
            <i class="fas fa-trash"></i>
            </button>
        </div>
        `).join("");


        if (!rows) {
            rows = `<p style="opacity:0.7;">Aucune spécialisation.</p>`;
        }

        const content = `
            <div>
                ${rows}
                <hr/>
                <button type="button" class="spec-add">
                    <i class="fas fa-plus"></i> Ajouter une spécialisation
                </button>
            </div>
        `;

        new Dialog({
            title: `Gérer les spécialisations — ${item.name}`,
            content,
            buttons: {
                save: {
                    label: "Enregistrer",
                    callback: async (html) => {
                        const root = html[0];
                        const newSpecs = {};

                        root.querySelectorAll(".form-group").forEach(row => {
                            // si la ligne est marquée à supprimer => on l’ignore
                            if (row.classList.contains("to-delete")) return;

                            const nameInput = row.querySelector('input[type="text"]');
                            const levelInput = row.querySelector('input[type="number"]');
                            if (!nameInput || !levelInput) return;

                            const key = nameInput.value.trim();
                            const val = Number(levelInput.value);
                            if (!key || !Number.isFinite(val)) return;

                            newSpecs[key] = Math.max(2, val);
                        });

                        await item.update({ "system.specialisations": newSpecs });
                    }




                },
                cancel: { label: "Annuler" }
            },
            render: (html) => {
                // Bouton supprimer
                html.find(".spec-delete").on("click", ev => {
                    const row = ev.currentTarget.closest(".form-group");
                    if (!row) return;

                    row.classList.toggle("to-delete");
                    row.style.opacity = row.classList.contains("to-delete") ? "0.4" : "1";
                });





                // Bouton ajouter
                html.find(".spec-add").on("click", async () => {
                    const chosen = await this._promptChooseSpec(item, mode, options, specs);
                    if (!chosen) return;

                    if (specs[chosen] !== undefined) {
                        return ui.notifications.warn("Cette spécialisation existe déjà.");
                    }

                    specs[chosen] = Math.max(2, specAt || 9);
                    await item.update({ "system.specialisations": specs });
                });
            }
        }).render(true);
    }


  async _manageSpecialisations(itemId) {
    if (!game.user.isGM) return;

    const actor = this.document;
    const item = actor.items.get(itemId);
    if (!item) return;

    const specAt = Number(item.system.specialisationAt ?? 0);
    const mode = item.system.specialisationMode ?? "fixed";
    const options = item.system.specialisationOptions ?? [];
    const specs = item.system.specialisations ?? {};

    const rows = Object.entries(specs).map(([key, value]) => `
      <div class="form-group" data-spec-key="${key}" style="display:flex; gap:6px; align-items:center; width:100%;">
        <input type="text" value="${key}" disabled style="flex:1 1 auto; min-width:180px;" />
        <input type="number" value="${value}" min="2" style="width:60px; flex:0 0 auto;" />
        <button type="button" class="spec-delete" title="Supprimer"
                style="width:28px; height:28px; padding:0; line-height:28px; flex:0 0 auto;">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join("") || `<p class="no-specs" style="opacity:.7">Aucune spécialisation.</p>`;

    const content = `
      <div class="spec-list">
        ${rows}
      </div>
      <hr/>
      <button type="button" class="spec-add">
        <i class="fas fa-plus"></i> Ajouter une spécialisation
      </button>
    `;

    new Dialog({
      title: `Gérer les spécialisations — ${item.name}`,
      content,
      buttons: {
        save: {
          label: "Enregistrer",
          callback: async (html) => {
            const root = html[0];
            const newSpecs = {};

            root.querySelectorAll(".form-group").forEach(row => {
              if (row.classList.contains("to-delete")) return;
              const key = row.dataset.specKey;
              const level = Number(row.querySelector('input[type="number"]')?.value);
              if (!key || !Number.isFinite(level)) return;
              newSpecs[key] = Math.max(2, level);
            });

            await item.update({ "system.specialisations": newSpecs });
          }
        },
        cancel: { label: "Annuler" }
      },
      render: (html) => {
        html.on("click", ".spec-delete", ev => {
          const row = ev.currentTarget.closest(".form-group");
          if (!row) return;
          row.classList.toggle("to-delete");
          row.style.opacity = row.classList.contains("to-delete") ? "0.4" : "1";
        });

        html.find(".spec-add").on("click", async () => {
          const chosen = await this._promptChooseSpec(item, mode, options, {});
          if (!chosen) return;

          const list = html[0].querySelector(".spec-list");
          if (!list) return;

          if ([...list.querySelectorAll(".form-group")].some(r => r.dataset.specKey === chosen)) {
            return ui.notifications.warn("Cette spécialisation existe déjà.");
          }

          const level = Math.max(2, specAt || 9);
          const row = document.createElement("div");
          row.className = "form-group";
          row.dataset.specKey = chosen;
          row.style.display = "flex";
          row.style.gap = "6px";
          row.style.alignItems = "center";
          row.style.width = "100%";

          row.innerHTML = `
            <input type="text" value="${chosen}" disabled style="flex:1 1 auto; min-width:180px;" />
            <input type="number" value="${level}" min="2" style="width:60px; flex:0 0 auto;" />
            <button type="button" class="spec-delete" title="Supprimer"
                    style="width:28px; height:28px; padding:0; line-height:28px; flex:0 0 auto;">
              <i class="fas fa-trash"></i>
            </button>
          `;

          const empty = list.querySelector(".no-specs");
          if (empty) empty.remove();
          list.appendChild(row);
        });
      }
    }).render(true);
  }

}