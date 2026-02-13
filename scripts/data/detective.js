export class DetectiveData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        const fields = foundry.data.fields;

        return {
            identite: new fields.SchemaField({
                grade: new fields.StringField({ initial: "Détective" }),
                entreeCops: new fields.StringField({ initial: "" }),
                origineSociale: new fields.StringField({ initial: "" }),
                education: new fields.StringField({ initial: "" })
            }),
            ressources: new fields.SchemaField({
                pv: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 10, integer: true }),
                    max: new fields.NumberField({ initial: 10, integer: true })
                }),
                adrenaline: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 0, min: 0, max: 5, integer: true }),
                    max: new fields.NumberField({ initial: 5, integer: true })
                }),
                anciennete: new fields.NumberField({ initial: 0, min: 0, integer: true }),
                xp: new fields.NumberField({ initial: 0, min: 0, integer: true })
            }),
            // --- C'EST CETTE SECTION QUI MANQUAIT PEUT-ÊTRE ---
            combat: new fields.SchemaField({
                attitude: new fields.StringField({ initial: "normal" }),
                etat: new fields.StringField({ initial: "normal" }), // "normal", "choc", "terre"
                diffChoc: new fields.NumberField({ initial: 0 }),    // Difficulté initiale
                toursTerre: new fields.NumberField({ initial: 0 })   // Compteur de rounds
            }),
            // --------------------------------------------------
            caracteristiques: new fields.SchemaField({
                carrure: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) }),
                charme: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) }),
                coordination: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) }),
                education: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) }),
                perception: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) }),
                reflexes: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) }),
                sangFroid: new fields.SchemaField({ value: new fields.NumberField({ initial: 2, min: 1, max: 5 }), hasBlue: new fields.BooleanField({ initial: false }) })
            }),
            biographie: new fields.HTMLField({ initial: "" }),
            notes: new fields.HTMLField({ initial: "" })
        };
    }
}