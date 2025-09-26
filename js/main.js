// js/main.js
// Version 9.5
import { wireStaticEvents, wireDynamicProviderEvents } from './uiEvents.js';
import { state } from './state.js';
import { exportCsv, exportPdf } from './export.js';
import { initializeDefaultProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';

document.addEventListener('DOMContentLoaded', () => {
  initializeDefaultProviders();
  renderProviderSettings();
  wireStaticEvents();
  wireDynamicProviderEvents();
  document.getElementById("exportCsv")?.addEventListener("click", () => exportCsv(state));
  document.getElementById("exportPdf")?.addEventListener("click", () => exportPdf(state));
});