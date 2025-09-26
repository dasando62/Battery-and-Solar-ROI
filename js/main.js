// js/main.js
// Version 9.6 (Final)
import { wireStaticEvents, wireDynamicProviderEvents } from './uiEvents.js';
import { state } from './state.js';
import { exportCsv, exportPdf } from './export.js';
import { initializeDefaultProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';

document.addEventListener('DOMContentLoaded', () => {
  initializeDefaultProviders();
  renderProviderSettings();
  
  // Wire the events
  wireStaticEvents();      // Wire the main page buttons ONCE.
  wireDynamicProviderEvents(); // Wire the provider-specific buttons.

  // Wire export buttons
  document.getElementById("exportCsv")?.addEventListener("click", () => exportCsv(state));
  document.getElementById("exportPdf")?.addEventListener("click", () => exportPdf(state));
});