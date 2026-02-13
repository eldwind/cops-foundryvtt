// IMPORTS DES MODÈLES
import { DetectiveData } from "./data/detective.js";
import { WeaponData, SkillData, ArmorData, GearData, StageData, ContactData } from "./data/item-models.js";
import "./chargen/index.js";

// IMPORTS DES CLASSES ET FEUILLES
import { CopsActor } from "./cops-actor.js"; 
import { DetectiveSheet } from "./detective-sheet.js"; 
import { CopsItem } from "./cops-item.js"; 
import { CopsItemSheet } from "./item-sheet.js";
// IMPORTANT : On importe les fonctions liées aux tirs (impact + application manuelle)
import { resolveHit, applyDamageFromChat } from "./dice.js";

class CopsCombat extends Combat {
    async rollInitiative(ids, {formula=null, updateTurn=true, messageOptions={}}={}) {
        for (let id of ids) {
            const combatant = this.combatants.get(id);
            if (combatant && combatant.actor) {
                await combatant.actor.rollInitiative();
            }
        }
        return this;
    }
}

Hooks.once("init", () => {
    console.log("------------------------------------------------");
    console.log(">>> C.O.P.S V3 | DÉMARRAGE DU SYSTÈME <<<");
    console.log("------------------------------------------------");

    CONFIG.Actor.documentClass = CopsActor; 
    CONFIG.Item.documentClass = CopsItem;
    CONFIG.Combat.documentClass = CopsCombat; 

    CONFIG.Actor.dataModels = {
        character: DetectiveData,
        npc: DetectiveData
    };

    CONFIG.Item.dataModels = {
        arme: WeaponData,
        skill: SkillData,
        protection: ArmorData,
        materiel: GearData,
        stage: StageData,
        contact: ContactData
    };

    CONFIG.Combat.initiative = {
        formula: "1d10",
        decimals: 2
    };

    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);

    foundry.documents.collections.Actors.registerSheet("cops", DetectiveSheet, {
        types: ["character", "npc"],
        makeDefault: true,
        label: "Dossier C.O.P.S"
    });

    foundry.documents.collections.Items.registerSheet("cops", CopsItemSheet, {
        makeDefault: true,
        label: "Fiche d'Objet C.O.P.S"
    });

    preloadTemplates();
});

async function preloadTemplates() {
    const templatePaths = [
        "systems/cops/templates/detective-sheet.html",
        "systems/cops/templates/item-sheet.html"
    ];
    return foundry.applications.handlebars.loadTemplates(templatePaths);
}

/**
 * Remplace le bouton "Appliquer" d'un message de dégâts par un indicateur non cliquable.
 * Cette opération nécessite les droits d'édition du ChatMessage (souvent MJ ou auteur du message).
 */
async function markDamageMessageApplied(messageId) {
    const msg = game.messages.get(messageId);
    if (!msg) return;

    // Évite toute tentative d'update côté client sans droits.
    // (Sinon Foundry logge une erreur "lacks permission to update ChatMessage".)
    if (!game.user.isGM && !msg.isOwner) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = msg.content;

    const oldBtn = wrapper.querySelector(".cops-apply-damage");
    if (!oldBtn) return;

    const done = document.createElement("span");
    done.classList.add("cops-damage-applied");
    done.setAttribute(
        "style",
        "display:inline-block;padding:4px 8px;border-radius:4px;opacity:.9;font-weight:600;background:#1b4332;color:#d8f3dc;"
    );
    done.textContent = "✔ Dommages appliqués";
    oldBtn.replaceWith(done);

    const note = wrapper.querySelector('.cops-apply-damage-note');
    if (note) note.remove();

    await msg.update({ content: wrapper.innerHTML });
}

// Socket : permet au MJ de "marquer comme appliqués" les dégâts quand le cliqueur n'a pas le droit de modifier le message.
Hooks.once("ready", () => {
    game.socket.on("system.cops", async (payload) => {
        if (!payload || payload.type !== "cops:markDamageApplied") return;
        if (!game.user.isGM) return;
        try {
            await markDamageMessageApplied(payload.messageId);
        } catch (e) {
            console.warn("[COPS] Impossible de mettre à jour le message de dégâts (MJ)", e);
        }
    });
});

   // --- AUTO-OPEN WIZARD ON NEW CHARACTER CREATION ---
Hooks.on("createActor", async (actor, options, userId) => {
  // uniquement l'utilisateur qui a créé l'acteur
  if (game.user.id !== userId) return;

  // seulement PJ
  if (actor.type !== "character") return;

  // évite imports / duplications / créations internes
  if (options?.fromChargen || options?.fromCompendium || options?.fromImport || options?.duplicateSource) return;

  // ferme la fiche auto si elle s'ouvre
  try { await actor.sheet?.close?.(); } catch (e) {}

  // ouvre le wizard (une seule fois)
  if (typeof actor.applyCreationWizard === "function") {
    await actor.applyCreationWizard();
  } else {
    console.warn("COPS | applyCreationWizard introuvable sur actor", actor);
  }
});



// --- LE CERVEAU DE L'ANCIENNETÉ (GOMME CORRECTRICE CUMULATIVE) ---
Hooks.on("renderChatMessageHTML", (message, html, data) => {
    // --- APPLIQUER DÉGÂTS (MJ) ---
    const dmgBtn = html.querySelector(".cops-apply-damage");
    if (dmgBtn) {
        // Ajuste l'UI selon les droits (MJ ou propriétaire de la cible)
        try {
            const sceneId = dmgBtn.dataset.sceneId;
            const tokenId = dmgBtn.dataset.tokenId;
            const scene = game.scenes.get(sceneId);
            const tokenDoc = scene?.tokens?.get(tokenId) ?? null;
            const canApplyNow = Boolean(game.user.isGM || tokenDoc?.isOwner || tokenDoc?.actor?.isOwner);
            const note = html.querySelector('.cops-apply-damage-note');
            if (canApplyNow) {
                dmgBtn.textContent = 'Appliquer';
                if (note) note.textContent = '';
            } else {
                dmgBtn.textContent = 'Appliquer';
                dmgBtn.disabled = true;
                dmgBtn.title = "Réservé au MJ ou au propriétaire de la cible";
                if (note) note.textContent = 'Réservé au MJ ou au propriétaire de la cible.';
            }
        } catch (e) {
            // En cas d'erreur de récupération, on laisse le comportement par défaut.
        }
        dmgBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const button = ev.currentTarget;
            const sceneId = button.dataset.sceneId;
            const tokenId = button.dataset.tokenId;
            const damage = Number(button.dataset.damage ?? 0);
            const fa = Number(button.dataset.fa ?? 0);

            // Autorisation : MJ OU propriétaire de la cible (joueur touché)
            // - token.isOwner couvre les tokens non-liés
            // - token.actor.isOwner couvre les tokens liés / ownership actor
            let tokenDoc = null;
            try {
                const scene = game.scenes.get(sceneId);
                tokenDoc = scene?.tokens?.get(tokenId) ?? null;
            } catch (e) {
                tokenDoc = null;
            }

            const canApply = Boolean(game.user.isGM || tokenDoc?.isOwner || tokenDoc?.actor?.isOwner);
            if (!canApply) {
                return ui.notifications.warn("Vous n'avez pas la permission d'appliquer ces dégâts.");
            }

            // Désactive le bouton pour éviter le double-clic
            button.disabled = true;
            try {
                await applyDamageFromChat({ sceneId, tokenId, damage, fa });

                // Remplace le bouton par "✔ Dommages appliqués".
                // IMPORTANT : si l'utilisateur n'a pas les droits d'update du ChatMessage,
                // Foundry logge une erreur en console. Donc on ne tente pas l'update côté joueur.
                if (game.user.isGM || message.isOwner) {
                    await markDamageMessageApplied(message.id);
                } else {
                    game.socket.emit("system.cops", {
                        type: "cops:markDamageApplied",
                        messageId: message.id
                    });
                }

                ui.notifications.info("Dégâts appliqués.");
            } catch (err) {
                console.error("[COPS] Impossible d'appliquer les dégâts", err);
                ui.notifications.error("Impossible d'appliquer les dégâts.");
                button.disabled = false;
            }
        });
    }

    const btn = html.querySelector(".spend-anciennete");
    if (btn) {
        btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            
            const button = ev.currentTarget;
            const actorId = button.dataset.actorId;
            const actor = game.actors.get(actorId);

            const type = button.dataset.type || "generique";
            const diff = parseInt(button.dataset.diff) || 7;
            let currentSucc = parseInt(button.dataset.successes) || 0;
            const weaponId = button.dataset.weaponId;

            if (!actor) return ui.notifications.warn("Acteur introuvable.");

            const currentAnc = actor.system.ressources.anciennete;
            if (currentAnc > 0) {
                // 1. Dépense
                await actor.update({ "system.ressources.anciennete": currentAnc - 1 });
                
                // 2. Mise à jour du score
                const newScore = currentSucc + 1;
                const isSuccessNow = newScore >= 1; 
                
                // 3. Feedback Intelligent
                let actionText = "Coup de pouce";
                let effectText = "";
                let updatedContent = message.content;

                // Mise à jour visuelle du compteur dans le message
                updatedContent = updatedContent.replace(
                    /data-successes="(\d+)"/, 
                    `data-successes="${newScore}"`
                );
                
                // 4. AIGUILLAGE
                if (type === "recuperation") {
                    actionText = "Second Souffle";
                    if (isSuccessNow) {
                        effectText = `<span style='color:#4f4'>Le personnage se relève !</span>`;
                        await actor.unsetFlag("cops", "roundTombe");
                        await actor.update({ "system.combat.etat": "normal" });
                    } else {
                        effectText = `<span style='color:#fa0'>Encore insuffisant (Total: ${newScore})...</span>`;
                    }
                }
                else if (type === "choc") {
                    actionText = "Résistance";
                    if (isSuccessNow) {
                        effectText = `<span style='color:#4f4'>Choc encaissé !</span>`;
                        await actor.unsetFlag("cops", "roundTombe");
                        await actor.update({ "system.combat.etat": "normal" });
                    } else {
                        effectText = `<span style='color:#fa0'>Encore insuffisant (Total: ${newScore})...</span>`;
                    }
                }
                else if (type === "attaque") {
                    actionText = "Balle Magique";
                    if (isSuccessNow) {
                        // RECONSTRUCTION COMPLETE DE L'IMPACT
                        const weapon = actor.items.get(weaponId);
                        if (weapon) {
                            // On cible la même cible que le jet original (si possible)
                            const targets = game.user.targets;
                            const target = targets.size > 0 ? targets.first().actor : null;
                            const burstCount = 1 + (newScore - 1);
                            
                            // On génère le HTML complet (Dés de loc, Dégâts...)
                            const impact = await resolveHit(actor, weapon, false, burstCount, target);
                            effectText = impact?.html ?? "";
                        } else {
                            effectText = `<span style='color:#4f4'>Succès validé (Arme introuvable)</span>`;
                        }
                    }
                }
                else {
                    actionText = "Expérience";
                    effectText = `<span style='color:#4f4'>Action validée (Total: ${newScore})</span>`;
                }

                // 5. Confirmation dans le chat
                ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor: actor }),
                    content: `<div style="background:#005; color:#fff; padding:5px; border-radius:4px; text-align:center; border:1px solid #44a;">
                        <strong>🎓 ANCIENNETÉ (${actionText})</strong><br>
                        1 Point dépensé.<br>Nouveau Total : <strong>${newScore} Succès</strong><br>
                        ${effectText}
                    </div>`
                });

                // 6. Mise à jour du bouton d'origine
                await message.update({ content: updatedContent });

            } else {
                ui.notifications.warn("Plus de points d'ancienneté disponibles !");
                button.disabled = true;
            }
        });
    }
});

// --- AUTOMATISATION DU COMBAT ---
Hooks.on("updateCombat", async (combat, updateData, context) => {
    if (!updateData.turn && !updateData.round) return;

    const combatant = combat.combatant;
    if (!combatant || !combatant.actor) return;

    const actor = combatant.actor;
    if (!actor.isOwner) return;

    const currentRound = (combat.round > 0) ? combat.round : 1;

    // --- 1. DISSIPATION DU CHOC ---
    if (actor.system.combat?.etat === "choc") {
        const roundChute = actor.getFlag("cops", "roundTombe") || 0;
        if (currentRound > roundChute) {
            await actor.unsetFlag("cops", "roundTombe");
            await actor.update({ "system.combat.etat": "normal" });
            ui.notifications.info(`${actor.name} reprend ses esprits (Choc dissipé).`);
        }
    }

    // --- 2. RÉCUPÉRATION À TERRE ---
    if (actor.system.combat?.etat === "terre") {
        setTimeout(() => {
            actor.recoverFromTerre();
        }, 500);
    }
});

import { open as openChargenWizard } from "./chargen/wizard-v2.js";


