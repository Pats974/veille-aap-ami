import { createStore } from "./store.js";
import { createUI } from "./ui.js";

async function main() {
  const store = createStore();
  const ui = createUI(store);
  ui.initBindings();
  await store.loadDataset();
  ui.render();
}

main();
