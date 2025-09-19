// js/main.js
import { setupUiEvents } from './uiEvents.js';
import { exportCsv, exportPdf } from './export.js';
import { state } from './state.js';

// Attach UI event wiring after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupUiEvents();
  
  // Wire export buttons
  document.getElementById("exportCsv")?.addEventListener("click", () => exportCsv(state));
  document.getElementById("exportPdf")?.addEventListener("click", () => exportPdf(state));
});