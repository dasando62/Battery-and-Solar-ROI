// js/storage.js
//Version 1.1.1
// This module handles the saving and loading of the entire application state
// to and from a JSON configuration file. This allows users to persist their
// settings and provider configurations.

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

import { getProviders, saveAllProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';
import { downloadBlob } from './utils.js';
import { state } from './state.js';

/**
 * Gathers all current values from UI input fields (text, number, checkbox)
 * and returns them as a single object, keyed by the element's ID.
 * @returns {object} An object containing all UI input values.
 */
function gatherAllInputs() {
    const inputs = {};
    // Select all number and text inputs with an ID.
    document.querySelectorAll('input[type="number"], input[type="text"]').forEach(input => {
        if (input.id) {
            inputs[input.id] = input.value;
        }
    });
    // Select all checkboxes with an ID.
    document.querySelectorAll('input[type="checkbox"]').forEach(input => {
        if (input.id) {
            inputs[input.id] = input.checked;
        }
    });
    return inputs;
}

/**
 * Applies a saved set of input values back to the UI form elements.
 * @param {object} inputs - An object with input values, keyed by element ID.
 */
function applyAllInputs(inputs) {
    for (const id in inputs) {
        const element = document.getElementById(id);
        if (element) {
            // Apply value based on element type.
            if (element.type === 'checkbox') {
                element.checked = inputs[id];
            } else {
                element.value = inputs[id];
            }
            // Trigger a 'change' event to ensure any dependent UI logic is executed.
            element.dispatchEvent(new Event('change'));
        }
    }
}

/**
 * Main function to save the entire application state (providers and UI inputs) to a JSON file.
 */
function saveStateToFile() {
    // Construct the state object to be saved.
    const appState = {
        version: "1.0.2", // Version of the settings file format.
        savedAt: new Date().toISOString(),
        providers: getProviders(), // Get all current provider configurations.
        uiInputs: gatherAllInputs(), // Get all current UI input values.
        // Note: We don't save CSV data itself, only the configuration settings.
    };

    // Convert the state object to a nicely formatted JSON string.
    const jsonString = JSON.stringify(appState, null, 2);
    // Use the utility function to trigger a download of the JSON file.
    downloadBlob('roi-analyzer-settings.json', jsonString, 'application/json');
}

/**
 * Main function to load and apply application state from a user-selected JSON file.
 * @param {Event} event - The file input change event.
 */
function loadStateFromFile(event) {
    const file = event.target.files[0];
    const statusEl = document.getElementById('settingsFileStatus');
    
    // Clear any previous status messages.
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = ''; // Reset color.
    }
    
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const appState = JSON.parse(e.target.result);
            
            // Validate the file structure.
            if (!appState.version || !appState.providers || !appState.uiInputs) {
                const errorMsg = "Error: This does not appear to be a valid settings file.";
                if (statusEl) {
                    statusEl.textContent = errorMsg;
                    statusEl.style.color = 'red';
                } else {
                    alert(errorMsg);
                }
                return;
            }

            // If valid, apply the loaded state.
            saveAllProviders(appState.providers); // Overwrite existing providers.
            applyAllInputs(appState.uiInputs);   // Restore UI input values.
            renderProviderSettings();             // Re-render the provider UI with new data.
            
            // Display a success message to the user.
            if (statusEl) {
                const providerCount = appState.providers.length;
                statusEl.textContent = `Loaded '${file.name}' with ${providerCount} provider configuration(s).`;
                statusEl.style.color = 'green';
            }

        } catch (error) {
            console.error("Failed to load or parse settings file:", error);
            const errorMsg = "Failed to load settings. The file may be corrupt.";
            if (statusEl) {
                statusEl.textContent = errorMsg;
                statusEl.style.color = 'red';
            } else {
                alert(errorMsg);
            }
        } finally {
            // Reset the file input so the user can load the same file again if needed.
            event.target.value = null;
        }
    };
    reader.readAsText(file);
}

/**
 * Wires up the event listeners for the Save and Load settings buttons.
 */
export function wireSaveLoadEvents() {
    document.getElementById('saveSettings')?.addEventListener('click', saveStateToFile);
    document.getElementById('loadSettings')?.addEventListener('change', loadStateFromFile);
}