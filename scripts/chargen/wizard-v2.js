// systems/cops/scripts/chargen/wizard-v2.js
console.log("COPS | chargen wizard-v2 loaded");

export function open({ actorId } = {}) {
  new CopsCreationWizard({
    window: { actorId }
  }).render(true);
}

