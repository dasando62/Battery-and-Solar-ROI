// js/main.js
//Version 1.0.8
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

  // Wire export buttons
  document.getElementById("exportCsv")?.addEventListener("click", () => exportCsv(state));
  document.getElementById("exportPdf")?.addEventListener("click", () => exportPdf(state));
});