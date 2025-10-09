// js/main.js
//Version 1.1.2
// This is the main entry point for the application. It initializes the application state,
// sets up default data, and wires up all the necessary event listeners once the DOM is fully loaded.

/*
 * Home Battery & Solar ROI Analyzer
 * Copyright (c) 2025 [DaSando62]
 *
 * This software is licensed under the MIT License.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { wireStaticEvents, wireDynamicProviderEvents } from './uiEvents.js';
import { state } from './state.js';
import { exportCsv, exportPdf } from './export.js';
import { initializeDefaultProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';

/**
 * Main execution block that runs after the HTML document has been completely loaded and parsed.
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Load the default provider configurations into localStorage if this is the first time the app is run.
  initializeDefaultProviders();
  // 2. Render the provider settings UI from the data stored in localStorage.
  renderProviderSettings();
  
  // 3. Attach event listeners to all static elements on the page (e.g., main buttons, inputs).
  wireStaticEvents();
  // 4. Attach event listeners to the dynamically generated provider setting elements.
  wireDynamicProviderEvents();

  // 5. Wire up the export buttons to their respective functions.
  document.getElementById("exportCsv")?.addEventListener("click", () => exportCsv(state));
  document.getElementById("exportPdf")?.addEventListener("click", () => exportPdf(state));
});