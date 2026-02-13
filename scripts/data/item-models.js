const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;

export class DetectiveData extends TypeDataModel {
    static defineSchema() {
        return {
            biographie: new fields.HTMLField(),
            identite: new fields.SchemaField({
                grade: new fields.StringField({initial: ""}),
                entreeCops: new fields.StringField({initial: ""}),
                origineSociale: new fields.StringField({initial: ""}),
                education: new fields.StringField({initial: ""})
            }),
            ressources: new fields.SchemaField({
                pv: new fields.SchemaField({
                    value: new fields.NumberField({initial: 10}),
                    max: new fields.NumberField({initial: 10})
                }),
                adrenaline: new fields.SchemaField({
                    value: new fields.NumberField({initial: 0}),
                    max: new fields.NumberField({initial: 5})
                }),
                anciennete: new fields.NumberField({initial: 0}),
                xp: new fields.NumberField({initial: 0})
            }),
            caracteristiques: new fields.SchemaField({
                carrure: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) }),
                coordination: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) }),
                reflexes: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) }),
                sangFroid: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) }),
                education: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) }),
                perception: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) }),
                charme: new fields.SchemaField({ value: new fields.NumberField({initial: 2, min: 1, max: 5}), hasBlue: new fields.BooleanField({initial: false}) })
            }),
            combat: new fields.SchemaField({
                etat: new fields.StringField({initial: "normal"}), // normal, choc, terre
                attitude: new fields.StringField({initial: "standard"}), // standard, ultra, agressif, prudent, planque
                diffChoc: new fields.NumberField({initial: 0}),
                toursTerre: new fields.NumberField({initial: 0}),
                // Stocke le round exact où le perso est tombé
                roundTombe: new fields.NumberField({initial: 0}) 
            })
        };
    }
}

export class WeaponData extends TypeDataModel {
    static defineSchema() {
        return {
            description: new fields.HTMLField(),
            competence: new fields.StringField({initial: "Arme de poing"}),
            caracteristique: new fields.StringField({ initial: "coordination" }),
            competenceSpec: new fields.StringField({ initial: "base" }),
            rafaleSpec: new fields.StringField({ initial: "base" }),
            precision: new fields.NumberField({initial: 0}),
            facteurArret: new fields.NumberField({initial: 0}),
            puissance: new fields.StringField({initial: "2d6"}),
            portee: new fields.StringField({initial: "10/30/100"}),
            valeurCouverture: new fields.NumberField({initial: 0}),
            rafaleCourte: new fields.NumberField({initial: 0}),
            cadenceTir: new fields.NumberField({initial: 1}),
            // --- NOUVEAU : Type de Munition (Lien avec Inventaire) ---
            ammoType: new fields.StringField({initial: ""}),
            munitions: new fields.SchemaField({
                value: new fields.NumberField({initial: 0}),
                max: new fields.NumberField({initial: 0})
            }),
            equipe: new fields.BooleanField({initial: false}),
            isFavorite: new fields.BooleanField({initial: false}), 
            useWeaponSkillForBurst: new fields.BooleanField({ initial: false }),
            isSpecial: new fields.BooleanField({initial: false})   
        };
    }
}

export class SkillData extends TypeDataModel {
    static defineSchema() {
        return {
            description: new fields.HTMLField(),
            allowAdrenaline: new fields.BooleanField({ initial: true }),
            niveau: new fields.NumberField({ initial: 10 }),
            caracteristique: new fields.StringField({ initial: "reflexes" }),

            // Legacy (on garde pour compat)
            specialisation: new fields.StringField({ initial: "" }),

            // --- NOUVEAU : configuration des spécialisations ---
            // 0 = pas de spécialisation ; 5..9 = palier
            specialisationAt: new fields.NumberField({ initial: 0 }),

            // "fixed" = liste fermée ; "free" = texte libre
            specialisationMode: new fields.StringField({
                initial: "fixed",
                choices: ["fixed", "free"]
            }),

            // Liste d’options si mode=fixed (ex: voiture, moto...)
            specialisationOptions: new fields.ArrayField(
                new fields.StringField({ initial: "" }),
                { initial: [] }
            ),

            // --- NOUVEAU : données de l’acteur ---
            // Map des spé achetées : { "Couteau": 6, "Moto": 7 }
            specialisations: new fields.ObjectField({ initial: {} }),

            hasBlue: new fields.BooleanField({ initial: false }),

            // --- NOUVEAU : dé bleu indépendant ---
            // Dé bleu pour le "Général"
            hasBlueBase: new fields.BooleanField({ initial: false }),

            // Dé bleu par spécialisation : { "Voiture": true, "Moto": false }
            hasBlueSpecs: new fields.ObjectField({ initial: {} })
        };
    }
}


export class ArmorData extends TypeDataModel {
    static defineSchema() {
        return {
            description: new fields.HTMLField(),
            formule: new fields.StringField({initial: "0"}),
            equipe: new fields.BooleanField({initial: false}),
            zones: new fields.SchemaField({
                tete: new fields.BooleanField({initial: false}),
                torse: new fields.BooleanField({initial: false}),
                bras: new fields.BooleanField({initial: false}),
                abdomen: new fields.BooleanField({initial: false}),
                jambes: new fields.BooleanField({initial: false})
            })
        };
    }
}

export class GearData extends TypeDataModel {
    static defineSchema() {
        return {
            description: new fields.HTMLField(),
            quantite: new fields.NumberField({initial: 1}),
            poids: new fields.NumberField({initial: 0})
        };
    }
}

export class StageData extends TypeDataModel {
    static defineSchema() {
        return {
            description: new fields.HTMLField(),
            niveau: new fields.NumberField({initial: 1, min: 1, max: 3}),
            // Pour les capacités actives (Bouton)
            hasAction: new fields.BooleanField({initial: false}),
            labelAction: new fields.StringField({initial: "Utiliser Capacité"}),
            descriptionAction: new fields.HTMLField({initial: ""}),
            coutAdrenaline: new fields.NumberField({initial: 0, min: 0}),
            coutAnciennete: new fields.NumberField({initial: 0, min: 0})
        };
    }
}

export class ContactData extends TypeDataModel {
    static defineSchema() {
        return {
            description: new fields.HTMLField(),
            // Type de relation : 'allie' ou 'informateur'
            type: new fields.StringField({initial: "allie"}), 
            // Niveau d'implication : 1 à 4
            niveau: new fields.NumberField({initial: 1, min: 1, max: 4}), 
            // Domaine d'activité (ex: "Journaliste", "Dealer")
            domaine: new fields.StringField({initial: ""}) 
        };
    }
}