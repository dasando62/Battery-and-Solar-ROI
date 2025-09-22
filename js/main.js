// js/main.js
//Version 7.8
import { setupUiEvents } from './uiEvents.js';
import { state } from './state.js';
import { exportCsv, exportPdf } from './export.js';

// attach UI event wiring after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupUiEvents();
  // wire export buttons
  document.getElementById("exportCsv")?.addEventListener("click", () => exportCsv(state));
  document.getElementById("exportPdf")?.addEventListener("click", () => exportPdf(state));
});