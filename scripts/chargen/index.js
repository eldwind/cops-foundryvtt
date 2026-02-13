import * as WizardV2 from "./wizard-v2.js";
import * as ChargenContacts from "./chargen-contacts.js";
import * as ChargenSkills from "./chargen-skills.js";
import * as ContactsEngineA from "./contacts-engine-a.js";

Hooks.once("ready", () => {
  game.cops = game.cops ?? {};
  game.cops.chargen = {
    wizard: WizardV2,
    contacts: ChargenContacts,
    skills: ChargenSkills,
    contactsEngineA: ContactsEngineA
  };

  console.log("COPS | Chargen v2 chargé");
});
