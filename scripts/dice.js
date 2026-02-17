const { DialogV2 } = foundry.applications.api;

// FONCTION EXPORTÉE POUR CALCULER ET AFFICHER UN IMPACT
/**
 * Calcule l'impact d'un tir (localisation, armure, bonus létal) et renvoie
 * le HTML détaillé + le total de PV à retrancher.
 *
 * IMPORTANT: Cette fonction n'applique PAS automatiquement les dégâts.
 * L'application se fait via un message "Appliquer" pour éviter les erreurs
 * de permissions (ActorDelta sur Token non possédé).
 */
export async function resolveHit(actor, weapon, isBurst, burstCount, target) {
    const fired = isBurst ? (weapon.system.rafaleCourte || 3) : 1;
    const hits = isBurst ? Math.min(fired, burstCount) : 1;

    // Cible: on accepte Token ou Actor (pour lire l'armure, attitude, etc.)
    const targetActor = target?.actor ?? target;


    const locRoll = await new Roll("1d10").evaluate();
    const baseLoc = locRoll.total;
    const locRollDetail = locRoll.result;
    let impactsHtml = "";
    let totalDamageApplied = 0;

    for (let i = 0; i < fired; i++) {
        if (isBurst && i >= hits) {
            impactsHtml += `<div class="cops-impact-miss">Balle ${i+1} : Manqué (pas assez de réussites)</div>`;
            continue;
        }
        const currentLoc = baseLoc + i;
        if (currentLoc > 10) {
            impactsHtml += `<div class="cops-impact-miss">Balle ${i+1} : Manqué (Au dessus)</div>`;
            continue;
        }

        let locName = "", locKey = "", bonusDiceFormula = "";
        if (currentLoc <= 2) { locName="JAMBES"; locKey="jambes"; } 
        else if (currentLoc <= 4) { locName="ABDOMEN"; locKey="abdomen"; bonusDiceFormula="1d6"; } 
        else if (currentLoc <= 7) { locName="TORSE"; locKey="torse"; bonusDiceFormula="2d6"; } 
        else if (currentLoc <= 9) { locName="BRAS"; locKey="bras"; } 
        else { locName="TÊTE"; locKey="tete"; bonusDiceFormula="3d6"; } 

        let weaponFormula = weapon.system.puissance || "1d6";
        if (weapon.system.isSpecial) weaponFormula += "r1"; 

        // --- DÉGÂTS ARME ---
        const weaponDmgRoll = await new Roll(weaponFormula).evaluate();
        const rawDamage = weaponDmgRoll.total;
        const weaponRollDetail = weaponDmgRoll.result;

        // --- ARMURE ---
        let armorAbsorb = 0;
        let armorRollDetail = "—";
        let armorName = "";

        if (targetActor) {
            const armorItem = targetActor.items.find(it =>
                (it.type === "protection" || it.type === "armor") &&
                it.system.equipe === true &&
                it.system.zones[locKey] === true
            );

            if (armorItem) {
                armorName = armorItem.name;
                const armorRoll = await new Roll(armorItem.system.formule).evaluate();
                armorAbsorb = armorRoll.total;
                armorRollDetail = armorRoll.result;
            }
        }

        const damageAfterArmor = Math.max(0, rawDamage - armorAbsorb);

        // --- BONUS LÉTAL ---
        let extraLethalDamage = 0;
        let bonusRollDetail = "";

        if (bonusDiceFormula !== "") {
            const bonusRoll = await new Roll(bonusDiceFormula).evaluate();
            extraLethalDamage = bonusRoll.total;
            bonusRollDetail = bonusRoll.result;
        }

        const dmgFinal = damageAfterArmor + extraLethalDamage;
        totalDamageApplied += dmgFinal;

        // --- HTML DÉTAILLÉ (repliable pour améliorer la lisibilité du chat) ---
impactsHtml += `
<details class="cops-impact">
    <summary>
        <span class="cops-impact-title"
              title="Jet de localisation : ${locRollDetail}${i > 0 ? ` | Décalage rafale : +${i}` : ""} | Total : ${currentLoc}">
            🎯 Balle ${i+1} : ${locName} (${currentLoc})
        </span>
        <span class="cops-impact-pv">PV : -${dmgFinal}</span>
    </summary>

    <div class="cops-impact-body">
        <div class="cops-impact-line" title="Dégâts bruts de l’arme (${weaponFormula})">
            🔫 Dégâts arme : <strong>${weaponRollDetail}</strong>
        </div>

        <div class="cops-impact-line" title="Protection de l’armure équipée couvrant la localisation (${locName})">
            🛡️ Protection ${armorName ? `(${armorName})` : ""} :
            <strong>${armorRollDetail}</strong>
        </div>

        <div class="cops-impact-line cops-impact-after-armor">
            ➖ Après armure : <strong>${damageAfterArmor}</strong>
        </div>

        ${extraLethalDamage > 0 ? `
        <div class="cops-impact-line cops-impact-lethal" title="Bonus létal lié à la localisation (${locName})">
            ☠️ Bonus létal : <strong>${bonusRollDetail}</strong>
        </div>` : ""}

        <div class="cops-impact-line cops-impact-final">
            ➡️ <strong>Perte de PV : ${dmgFinal}</strong>
        </div>
    </div>
</details>`;

}

    const title = isBurst ? "RÉSULTAT RAFALE (Détaillé)" : "IMPACT (Détaillé)";
const html = `
<div class="cops-impact-wrap">
    <h4 class="cops-impact-heading">${title}</h4>
    ${impactsHtml}
    ${targetActor ? `<div class="cops-impact-total">Total PV : -${totalDamageApplied}</div>` : ""}
</div>`;
return { html, totalDamageApplied };
}

/**
 * Applique des dégâts sur un Token (par un MJ) et déclenche un test de choc.
 * @param {object} payload
 * @param {string} payload.sceneId
 * @param {string} payload.tokenId
 * @param {number} payload.damage
 * @param {number} payload.fa
 */
export async function applyDamageFromChat(payload) {
    // Autorisé : MJ ou propriétaire de la cible (token/actor).
    // (Le bouton côté chat filtre déjà, mais on sécurise ici aussi.)
    const { sceneId, tokenId, damage, fa } = payload ?? {};
    if (!sceneId || !tokenId || !Number.isFinite(Number(damage))) return;

    const scene = game.scenes.get(sceneId);
    const tokenDoc = scene?.tokens.get(tokenId);
    const canApply = Boolean(game.user.isGM || tokenDoc?.isOwner || tokenDoc?.actor?.isOwner);
    if (!canApply) return;

    const token = tokenDoc?.object;
    const targetActor = token?.actor;
    if (!targetActor) return;

    const currentPV = Number(targetActor.system?.ressources?.pv?.value ?? 0);
    const newPV = Math.max(0, currentPV - Number(damage));
    await targetActor.update({ "system.ressources.pv.value": newPV });

    // Test de choc (comme avant)
    setTimeout(() => {
        triggerShockTest(targetActor, Number(fa) || 0);
    }, 200);
}




/**
 * Choisit quel utilisateur "possède" le message de dégâts, pour permettre au propriétaire de cliquer
 * et de mettre à jour le message (remplacer le bouton par "Dommages appliqués") sans erreur de droits.
 * - Priorité : un joueur (non-MJ) propriétaire de l'Actor cible (actif si possible)
 * - Sinon : un MJ actif
 * - Sinon : l'utilisateur courant
 */
function _pickDamageMessageUserId(targetActor) {
    try {
        if (targetActor) {
            const activePlayerOwner = game.users.find(u => !u.isGM && u.active && targetActor.testUserPermission(u, "OWNER"));
            if (activePlayerOwner) return activePlayerOwner.id;

            const anyPlayerOwner = game.users.find(u => !u.isGM && targetActor.testUserPermission(u, "OWNER"));
            if (anyPlayerOwner) return anyPlayerOwner.id;
        }

        const activeGM = game.users.find(u => u.isGM && u.active);
        if (activeGM) return activeGM.id;
    } catch (e) {
        // ignore
    }
    return game.user?.id;
}

export async function rollCops(pool, threshold, title, data = {}) {
    // Token cible (si présent) pour le speaker / application manuelle des dégâts
    const targetToken = (data.target && data.target.actor) ? data.target : null;

    // --- CONDITIONS DE TIR (PORTÉE & MODIFICATEUR) ---
let requiredSuccesses = 1;
let rangeLabel = "";
let rangeValue = 1;
let modValue = 0;

if (data.isAttack) {

  // Dernière portée mémorisée par l'utilisateur
  const lastRange = game.user.flags["cops"]?.lastRange ?? 2;

  // Si la sheet fournit déjà les conditions (portée / mod MJ), on ne ré-ouvre pas de 2ème fenêtre.
  if (data.attackConditions && (data.attackConditions.range !== undefined || data.attackConditions.mod !== undefined)) {
    rangeValue = Number(data.attackConditions.range ?? lastRange);
    modValue   = Number(data.attackConditions.mod ?? 0);

    // Mémorisation de la portée
    await game.user.setFlag("cops", "lastRange", rangeValue);

  } else {
    // DialogV2.input retourne directement un objet { range, mod } (ou undefined si fermé)
    const form = await DialogV2.input({
      window: { title: "Conditions de tir" },
      content: `
        <div class="form-group">
          <label>🎯 Portée du tir</label>
          <select name="range">
            <option value="1" ${lastRange === 1 ? "selected" : ""}>Courte (&lt; 10 m) — 1 réussite</option>
            <option value="2" ${lastRange === 2 ? "selected" : ""}>Moyenne (≤ portée arme) — 2 réussites</option>
            <option value="3" ${lastRange === 3 ? "selected" : ""}>Longue (≤ 2× portée arme) — 3 réussites</option>
          </select>
        </div>

        <div class="form-group">
          <label>⚖️ Modificateur MJ</label>
          <input type="number" name="mod" value="0" />
        </div>
      `,
      ok: { label: "Valider" },
      rejectClose: false
    });

    // Si le dialog est fermé → on continue quand même avec des valeurs par défaut
    rangeValue = Number(form?.range ?? lastRange);
    modValue   = Number(form?.mod ?? 0);

    // Mémorisation de la portée
    await game.user.setFlag("cops", "lastRange", rangeValue);
  }

  requiredSuccesses = Math.max(1, rangeValue + modValue);

  // Attitude en combat (cible) : ajuste les succès requis (min 1), sans toucher au seuil.
  if (data.isAttack && data.target) {
    const targetActor = data.target.actor ?? data.target;
    const tAtt = targetActor?.system?.combat?.attitude || "standard";
    let attMod = 0;
    if (tAtt === "ultra") attMod = -2;
    else if (tAtt === "agressif") attMod = -1;
    else if (tAtt === "prudent") attMod = 1;
    else if (tAtt === "planque") attMod = 2;
    requiredSuccesses = Math.max(1, requiredSuccesses + attMod);
  }

  rangeLabel =
    rangeValue === 1 ? "courte" :
    rangeValue === 2 ? "moyenne" :
    "longue";
}

    // --- NOUVEAU : DETECTION AUTOMATIQUE DES BONUS DE STAGE (ACTIVE EFFECTS) ---
    // Si l'acteur possède un flag 'blueDie.X' et que l'action a le tag 'X', on ajoute le dé bleu.
    if (data.actor && data.tags) {
        const flags = data.actor.flags["cops"]?.blueDie || {};
        
        // Vérifie si un tag match avec un flag actif
        const hasStageBonus = data.tags.some(tag => {
            // Normalisation : "Éducation" -> "education"
            const cleanTag = tag.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "");
            return flags[cleanTag] === true;
        });

        if (hasStageBonus) {
            data.blueDie = true;
            title += " <span style='font-size:0.8em; color:#00ccff; vertical-align:middle;' title='Bonus de Stage'><i class='fas fa-graduation-cap'></i></span>";
        }
    }
    // ---------------------------------------------------------------------------

    // 1. FORMULE
    let formula = "";
    let nbWhite = pool;
    let nbBlue = 0;

    if (data.blueDie && pool > 0) { nbWhite = pool - 1; nbBlue = 1; }
    if (nbWhite > 0) formula += `${nbWhite}d10x10`;
    if (nbBlue > 0) { if (formula !== "") formula += " + "; formula += `1d10x10[blue]`; }

    // Sécurité anti-formule vide (si pool <= 0)
    if (formula === "") formula = "0d10"; 

    const roll = new Roll(formula);
    await roll.evaluate();
    // if (game.modules.get("dice-so-nice")?.active) await game.dice3d.showForRoll(roll, game.user, true);

    // 2. ANALYSE
    let successes = 0;
    let diceHtml = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin: 5px 0;">`;
    
    let totalDiceCount = 0;
    let countTens = 0;
    let countOnes = 0;

    // Analyse dés blancs
    if (nbWhite > 0 && roll.terms[0]) {
        const whiteDice = roll.terms[0].results;
        for (let die of whiteDice) { 
            totalDiceCount++;
            if (die.result === 10) countTens++;
            if (die.result === 1) countOnes++;

            if (die.result >= threshold) successes++;
            let bgColor = "#eee"; let color = "#333"; let borderColor = "#999";
            if (die.result === 10) { bgColor = "#28a745"; color = "#fff"; borderColor = "#1e7e34"; } 
            else if (die.result === 1) { bgColor = "#dc3545"; color = "#fff"; borderColor = "#bd2130"; }
            diceHtml += `<span style="display:inline-block; width:24px; height:24px; line-height:22px; text-align:center; background:${bgColor}; color:${color}; border:1px solid ${borderColor}; border-radius:4px; font-weight:bold; font-family:monospace; font-size:1.1em;">${die.result}</span>`;
        }
    }

    // Analyse dés bleus
    if (nbBlue > 0) {
        // Le terme bleu est à l'index 2 si blanc existe (0 + 1 + 2), sinon 0
        const blueTermIndex = (nbWhite > 0) ? 2 : 0;
        if (roll.terms[blueTermIndex]) {
            const blueDice = roll.terms[blueTermIndex].results;
            for (let die of blueDice) { 
                totalDiceCount++;
                if (die.result === 10) countTens++;
                if (die.result === 1) countOnes++;

                if (die.result >= threshold) successes += 2;
                let bgColor = "#007bff"; let color = "#fff"; let borderColor = "#0056b3";
                if (die.result === 10) { bgColor = "#28a745"; borderColor = "#1e7e34"; } 
                else if (die.result === 1) { bgColor = "#dc3545"; borderColor = "#bd2130"; }
                diceHtml += `<span style="display:inline-block; width:24px; height:24px; line-height:22px; text-align:center; background:${bgColor}; color:${color}; border:1px solid ${borderColor}; border-radius:50%; font-weight:bold; font-family:monospace; font-size:1.1em; box-shadow: 0 0 3px #007bff;">${die.result}</span>`;
            }
        }
    }
    diceHtml += `</div>`;

    // --- ANALYSE CRITIQUE ---
    const halfDice = Math.ceil(totalDiceCount / 2);
    let critBanner = "";

    if (totalDiceCount > 0) {
        if (countTens >= halfDice) {
            critBanner = `
            <div style="background: linear-gradient(90deg, #b8860b, #ffd700, #b8860b); color: #fff; padding: 5px; text-align: center; font-weight: bold; text-transform: uppercase; border: 1px solid #fff; margin-bottom: 5px; border-radius: 4px; box-shadow: 0 0 5px #ffd700; text-shadow: 1px 1px 2px #000;">
                <i class="fas fa-medal"></i> ACTION HÉROÏQUE <i class="fas fa-medal"></i>
            </div>`;
        } else if (countOnes >= halfDice) {
            critBanner = `
            <div style="background: linear-gradient(90deg, #500, #a00, #500); color: #fff; padding: 5px; text-align: center; font-weight: bold; text-transform: uppercase; border: 1px solid #f55; margin-bottom: 5px; border-radius: 4px; box-shadow: 0 0 5px #f00; text-shadow: 1px 1px 2px #000;">
                <i class="fas fa-exclamation-triangle"></i> BAVURE <i class="fas fa-exclamation-triangle"></i>
            </div>`;
        }
    }

    // 3. BOUTON ANCIENNETE
    let ancBtn = "";
    if (data.actor && data.actor.system.ressources.anciennete > 0) {
        const weaponId = data.weapon ? data.weapon.id : "";
        ancBtn = `<button class="spend-anciennete" 
            data-actor-id="${data.actor.id}" 
            data-weapon-id="${weaponId}"
            data-type="${data.type || 'generique'}" 
            data-diff="${threshold}" 
            data-successes="${successes}"
            style="margin-top:5px; background:#005; color:#fff; border:1px solid #aaf;">
            🎓 Ancienneté (+1 Succès)
        </button>`;
    }

    // 4. RESULTAT
    let additionalInfo = "";
    let pendingDamage = null; // { sceneId, tokenId, damage, fa, targetName }
    
   if (successes < requiredSuccesses) {

    if (data.type === "recuperation") {
        additionalInfo = `<div style="color:#b44; font-weight:bold;">ÉCHEC : Toujours à terre</div>`;

    } else if (data.isAttack) {
        additionalInfo = `
        <div style="color:#b44; font-weight:bold;">
            ❌ Raté (${successes} / ${requiredSuccesses} réussites)
        </div>`;

    } else {
        additionalInfo = `<div style="color:#b44; font-weight:bold;">ÉCHEC</div>`;
    }

} else {

    if (data.isAttack) {
        const burstCount = 1 + (successes - 1);

        additionalInfo = `
        <div style="color:#1f4f7a; font-size:0.9em; margin-bottom:4px;">
            ✅ Touché à portée ${rangeLabel}
            (${requiredSuccesses} réussite${requiredSuccesses > 1 ? "s" : ""} requise${requiredSuccesses > 1 ? "s" : ""})
        </div>
        `;

        const impact = await resolveHit(
            data.actor,
            data.weapon,
            data.isBurst,
            burstCount,
            data.target
        );
        additionalInfo += impact?.html ?? "";

        // Prépare un message "Appliquer" (pas d'auto-apply pour éviter les permissions).
        const targetToken = data.target?.actor ? data.target : null;
        const sceneId = targetToken?.scene?.id ?? canvas?.scene?.id;
        const tokenId = targetToken?.id;
        if (sceneId && tokenId && (impact?.totalDamageApplied ?? 0) > 0) {
            pendingDamage = {
                sceneId,
                tokenId,
                messageUserId: _pickDamageMessageUserId(targetToken?.actor),
                damage: Number(impact.totalDamageApplied),
                fa: Number(data.weapon?.system?.facteurArret ?? 0),
                targetName: targetToken.name ?? targetToken.actor?.name ?? "Cible"
            };
        }

    } else if (data.type === "recuperation") {

        additionalInfo = `<div class="cops-chat-outcome cops-chat-outcome-success">SUCCÈS : Vous vous relevez</div>`;
        await data.actor.unsetFlag("cops", "roundTombe");
        await data.actor.update({ "system.combat.etat": "normal" });

    } else {
        additionalInfo = `<div class="cops-chat-outcome cops-chat-outcome-success">SUCCÈS</div>`;
    }
}


    let content = `
    <div class="cops-chat-message cops-chat-card">
        ${critBanner}
        <h3 class="cops-chat-title">${title}</h3>
        ${diceHtml}
        <div class="cops-chat-successes">${successes} Succès</div>
        <div class="cops-chat-meta">Diff: ${threshold} | Pool: ${pool}</div>
        ${additionalInfo}
        ${ancBtn}
    </div>`;

    // IMPORTANT: on await la création pour garantir l'ordre dans le chat.
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: data.actor }), content: content });

    // Message 2 : dégâts à appliquer (MJ)
    if (pendingDamage) {
        const dmg = pendingDamage.damage;
        const dmgContent = `
<div class="cops-chat-message cops-chat-card cops-chat-danger">
    <h3 class="cops-chat-title">🩸 Dégâts à appliquer</h3>
    <div class="cops-chat-line"><strong>${pendingDamage.targetName}</strong> doit subir <strong>${dmg}</strong> PV.</div>
    <button class="cops-apply-damage"
            data-scene-id="${pendingDamage.sceneId}"
            data-token-id="${pendingDamage.tokenId}"
            data-damage="${dmg}"
            data-fa="${pendingDamage.fa}">
        Appliquer
    </button>
    <div class="cops-apply-damage-note"></div>
</div>`;
        await ChatMessage.create({
            user: pendingDamage.messageUserId ?? game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: targetToken?.actor ?? data.actor }),
            content: dmgContent,
            flags: { "cops": { damageApply: pendingDamage } }
        });
    }
}

async function triggerShockTest(targetActor, fa) {
    const diff = 6 + fa;
    const dialogContent = `<div style="text-align:center;"><h3 style="color:#ff5555;">TEST DE CHOC</h3><p>Cible : <strong>${targetActor.name}</strong></p><p>Diff: ${diff}</p></div>`;
    await DialogV2.wait({
        window: { title: "Résistance" }, content: dialogContent,
        buttons: [
            { action: "carrure", label: "CARRURE", callback: () => resolveShock(targetActor, "carrure", diff) },
            { action: "sangfroid", label: "SANG-FROID", callback: () => resolveShock(targetActor, "sangFroid", diff) }
        ]
    });
}

async function resolveShock(actor, attrKey, diff) {
    const pool = actor.system.caracteristiques[attrKey].value;
    const roll = new Roll(`${pool}d10x10`);
    await roll.evaluate();
    if (game.modules.get("dice-so-nice")?.active) await game.dice3d.showForRoll(roll, game.user, true);

    let successes = 0;
    const dice = roll.terms[0].results;
    for (let d of dice) { if (d.result >= diff) successes++; }

    const currentRound = (game.combat && game.combat.round > 0) ? game.combat.round : 1;
    let resultMsg = "";
    
    if (successes >= 1) { 
        resultMsg = "<span style='color:#4b4'>CHOC ENCAISSÉ</span>"; 
        await actor.unsetFlag("cops", "roundTombe");
        await actor.update({ "system.combat.etat": "normal" }); 
    } else { 
        resultMsg = "<span style='color:#b44'>À TERRE</span>"; 
        await actor.setFlag("cops", "roundTombe", currentRound);
        await actor.update({ "system.combat.etat": "terre", "system.combat.diffChoc": diff });
    }

    let ancBtn = "";
    if (actor.system.ressources.anciennete > 0) {
        ancBtn = `<button class="spend-anciennete" data-actor-id="${actor.id}" data-type="choc" data-diff="${diff}" data-successes="${successes}" style="margin-top:5px; background:#005; color:#fff; border:1px solid #aaf;">🎓 Ancienneté (+1 Succès)</button>`;
    }

    ChatMessage.create({
        content: `
        <div class="cops-chat-message cops-chat-card">
            <h3 class="cops-chat-title">RÉSULTAT CHOC</h3>
            <div class="cops-chat-successes">${successes} Succès</div>
            <div class="cops-chat-line">${resultMsg}</div>
            ${ancBtn}
        </div>`,
        speaker: ChatMessage.getSpeaker({ actor: actor })
    });
}