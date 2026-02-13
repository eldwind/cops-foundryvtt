const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class CopsItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    
    constructor(options) {
        super(options);
        this.currentTab = "description";
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["cops", "sheet", "item"],
        position: { width: 600, height: 600 },
        window: { resizable: true },
        form: { submitOnChange: true, closeOnSubmit: false }
    };

    static PARTS = {
        form: { template: "systems/cops/templates/item-sheet.html" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        
        context.item = this.document;
        context.system = this.document.system;
        const sys = this.document.system;
        context.view = context.view || {};
        context.view.hasBlueBase = ((sys.hasBlueBase ?? sys.hasBlue) === true);
        context.view.hasBlueSpecs = (sys.hasBlueSpecs ?? {});
        context.view.specCount = Object.keys(sys.specialisations ?? {}).length;

        context.specialisationOptionsText = (this.document.system.specialisationOptions ?? []).join(", ");
        context.owner = this.document.isOwner;
        context.editable = this.isEditable;
        context.tabs = { primary: this.currentTab };

        context.config = {
            combatSkills: {
                "Arme de poing": "Arme de poing", "Arme d'épaule": "Arme d'épaule", "Armes lourdes": "Armes lourdes", "Arme de contact": "Arme de contact", 
                "Corps à corps": "Corps à corps", "Tir en rafales": "Tir en rafales", "Lancer": "Lancer"
            },
            caracteristiques: {
                "carrure": "Carrure", "coordination": "Coordination", "reflexes": "Réflexes", "sangFroid": "Sang-froid", 
                "education": "Éducation", "perception": "Perception", "charme": "Charme"
            },
            contactTypes: {
                "allie": "🤝 Allié (Civil/Ami)", "informateur": "💰 Informateur (Truand/Vénal)"
            }
        };

                    // ---------------------------
                  // Spécialisations pour les armes
                  // ---------------------------
            context.weaponHasSpecs = false;
            context.weaponSpecOptions = [];
            context.rafaleHasSpecs = false;
            context.rafaleSpecOptions = [];

            if (this.document.type === "arme") {
            const pack = game.packs.get("cops.competences");
            if (pack) {
                await pack.getIndex();

                // Helper: récupérer options de spé depuis la compétence du compendium
                const _norm = (s) => String(s ?? "")
                .trim()
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");

                // alias pour corriger les noms "UI" -> noms compendium
                const SKILL_ALIASES = {
                "armes lourdes": "arme lourde",
                "armes d'epaule": "arme d'épaule",
                "armes de contact": "arme de contact",
                };

                const getSpecConfigForSkillName = async (skillName) => {
                if (!skillName) return { at: 0, opts: [] };

                const pack = game.packs.get("cops.competences");
                if (!pack) return { at: 0, opts: [] };

                await pack.getIndex();

                const wantedNorm = _norm(skillName);
                const aliasNorm = SKILL_ALIASES[wantedNorm] ?? wantedNorm;

                // 1) match direct tolérant (accents/casse)
                let entry = pack.index.find(e => _norm(e.name) === aliasNorm);

                // 2) fallback: si pas trouvé, tente le nom original normalisé (au cas où)
                if (!entry) entry = pack.index.find(e => _norm(e.name) === wantedNorm);

                if (!entry) return { at: 0, opts: [] };

                const doc = await pack.getDocument(entry._id);
                const at = Number(doc?.system?.specialisationAt ?? 0);
                const opts = doc?.system?.specialisationOptions ?? [];
                return { at, opts: Array.isArray(opts) ? opts : [] };
                };



                const baseSkillName = this.document.system.competence;
                const baseCfg = await getSpecConfigForSkillName(baseSkillName);

                // reset par sécurité
                context.weaponHasSpecs = false;
                context.weaponSpecOptions = [];

                if (this.document.type === "arme") {
                // Arme de poing = pas de spé
                const isPistol = baseSkillName?.localeCompare("Arme de poing", undefined, { sensitivity: "base" }) === 0;

                if (!isPistol && Number(baseCfg.at ?? 0) > 0) {
                    context.weaponHasSpecs = true;

                    // 9+ => pas de "Général"
                    if (Number(baseCfg.at) === 9) {
                    context.weaponSpecOptions = [...(baseCfg.opts ?? [])];
                    // valeur par défaut si vide
                    if (!context.weaponSpecOptions.length) context.weaponSpecOptions = ["(Aucune option configurée)"];
                    } else {
                    context.weaponSpecOptions = ["base", ...(baseCfg.opts ?? [])];
                    if (context.weaponSpecOptions.length === 1) context.weaponSpecOptions.push("(Aucune option configurée)");
                    }
                }
                }
                if (context.weaponHasSpecs && Number(baseCfg.at) === 9) {
                if (this.document.system.competenceSpec === "base") {
                    // force sur la première option dispo
                    const first = (baseCfg.opts ?? [])[0];
                    if (first) await this.document.update({ "system.competenceSpec": first });
                }
                }




                // Rafale : basé sur la compétence "Tir en rafales"
                const rafaleCfg = await getSpecConfigForSkillName("Tir en rafales");
                    if (rafaleCfg.at > 0) {
                    context.rafaleHasSpecs = true;
                    context.rafaleSpecOptions = (rafaleCfg.at === 9)
                        ? [...rafaleCfg.opts]
                        : ["base", ...rafaleCfg.opts];
                }

            }
            }


            context.enrichedDescription =
            await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.description ?? "",
            { secrets: this.document.isOwner }
        );

        context.enrichedDescriptionAction = await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.document.system.descriptionAction ?? "", { secrets: this.document.isOwner });

        return context;
    }

    async _updateObject(event, formData) {
        // textarea -> array pour system.specialisationOptions
        if (typeof formData.specialisationOptionsText === "string") {
            const raw = formData.specialisationOptionsText;

            // Split par virgule, trim, enlève les vides
            const options = raw
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

            formData["system.specialisationOptions"] = options;
            delete formData.specialisationOptionsText;
        }

        if (typeof formData["system.hasBlueBase"] === "boolean") {
            formData["system.hasBlue"] = formData["system.hasBlueBase"];
        }

        
        return super._updateObject(event, formData);
    }


    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        
        

        // --- LECTURE SEULE PJ SUR COMPÉTENCES ---
        const isSkill = (this.document.type === "competence" || this.document.type === "skill");
        const readOnlySkill = isSkill && !game.user.isGM;

        // --- GESTION DE L'ÉDITION DE L'IMAGE ---
        const img = html.querySelector(".profile-img");
        if (img && this.isEditable) {
            img.addEventListener("click", ev => this._onEditImage(ev));
        }

        // --- GESTION MANUELLE DES ONGLETS ---
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

        // --- GESTION DES ACTIONS (EFFETS) ---
        html.querySelectorAll("[data-action]").forEach(el => {
            el.addEventListener("click", (ev) => this._handleAction(ev));
        });

                    // --- SAUVEGARDE PROSEMIRROR (SheetV2) ---
            html.querySelectorAll("prose-mirror[name]").forEach(pm => {
            if (readOnlySkill) {
                // Forcer ProseMirror en lecture seule côté PJ pour les compétences
                pm.setAttribute("readonly", "true");
                const ed = pm.querySelector(".ProseMirror");
                if (ed) ed.setAttribute("contenteditable", "false");
                return;
            }
            if (pm.dataset.pmBound) return;
            pm.dataset.pmBound = "1";

            pm.addEventListener("save", async () => {
                const path = pm.getAttribute("name");          // ex: "system.description"
                const value = pm.value ?? "";

                await this.document.update({ [path]: value });
                this.render({ force: true });
            });
            });


        // --- VERROUILLAGE UI (PJ) : compétences en lecture seule ---
        if (readOnlySkill) {
            // Désactiver tous les champs de formulaire
            html.querySelectorAll("input, select, textarea").forEach(el => {
                el.disabled = true;
                try { el.readOnly = true; } catch (e) {}
            });

            // Empêcher le changement d'image même si l'owner est editable
            const imgRO = html.querySelector(".profile-img");
            if (imgRO) {
                imgRO.style.pointerEvents = "none";
                imgRO.style.opacity = "0.85";
            }

            // Masquer les contrôles qui créent/suppriment/modifient (effets, etc.)
            html.querySelectorAll(
                "[data-action*='create'], [data-action*='delete'], [data-action*='remove'], [data-action*='add'], button[type='submit']"
            ).forEach(el => {
                // On laisse les liens d'onglets/accordéons tranquilles
                if (el.classList.contains("item") || el.closest(".sheet-tabs")) return;
                el.style.display = "none";
            });
        }

    }

    /**
     * Ouvre le sélecteur de fichier pour changer l'image de l'item
     */
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

        if (action === "createEffect") {
            await this.document.createEmbeddedDocuments("ActiveEffect", [{
                name: "Nouvel Effet",
                img: "icons/svg/aura.svg",
                origin: this.document.uuid,
                disabled: false
            }]);
        }

        if (action === "editEffect") {
            const effectId = button.closest("[data-effect-id]").dataset.effectId;
            const effect = this.document.effects.get(effectId);
            effect.sheet.render(true);
        }

        if (action === "deleteEffect") {
            const effectId = button.closest("[data-effect-id]").dataset.effectId;
            const effect = this.document.effects.get(effectId);
            await effect.delete();
        }
    }
}