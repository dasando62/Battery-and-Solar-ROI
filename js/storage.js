// js/storage.js
//Version 1.0.3
import { getProviders, saveAllProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';
import { downloadBlob } from './utils.js';
import { state } from './state.js';

// Gathers all UI input values into a single object
function gatherAllInputs() {
    const inputs = {};
    document.querySelectorAll('input[type="number"], input[type="text"]').forEach(input => {
        if (input.id) {
            inputs[input.id] = input.value;
        }
    });
    document.querySelectorAll('input[type="checkbox"]').forEach(input => {
        if (input.id) {
            inputs[input.id] = input.checked;
        }
    });
    return inputs;
}

// Applies saved input values back to the UI
function applyAllInputs(inputs) {
    for (const id in inputs) {
        const element = document.getElementById(id);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = inputs[id];
            } else {
                element.value = inputs[id];
            }
            // Trigger a change event to make sure any associated UI updates happen
            element.dispatchEvent(new Event('change'));
        }
    }
}

// Main function to save the entire application state to a JSON file
function saveStateToFile() {
    const appState = {
        version: "1.0.2", // Version your settings file
        savedAt: new Date().toISOString(),
        providers: getProviders(),
        uiInputs: gatherAllInputs(),
        // We don't save CSV data, just the settings
    };

    const jsonString = JSON.stringify(appState, null, 2); // Pretty-print the JSON
    downloadBlob('roi-analyzer-settings.json', jsonString, 'application/json');
}

// Main function to load and apply state from a JSON file
// Replace the existing function in storage.js with this one
function loadStateFromFile(event) {
    const file = event.target.files[0];
    const statusEl = document.getElementById('settingsFileStatus');
    
    // Clear previous status messages
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = ''; // Reset color
    }
    
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const appState = JSON.parse(e.target.result);
            
            if (!appState.version || !appState.providers || !appState.uiInputs) {
                if (statusEl) {
                    statusEl.textContent = "Error: This does not appear to be a valid settings file.";
                    statusEl.style.color = 'red';
                } else {
                    alert("This does not appear to be a valid settings file.");
                }
                return;
            }

            saveAllProviders(appState.providers);
            applyAllInputs(appState.uiInputs);
            renderProviderSettings();
            
            // --- FIX: Replace alert() with a detailed status message ---
            if (statusEl) {
                const providerCount = appState.providers.length;
                statusEl.textContent = `Loaded '${file.name}' with ${providerCount} provider configuration(s).`;
                statusEl.style.color = 'green'; // Style the success message
            }

        } catch (error) {
            console.error("Failed to load or parse settings file:", error);
            if (statusEl) {
                statusEl.textContent = "Failed to load settings. The file may be corrupt.";
                statusEl.style.color = 'red';
            } else {
                alert("Failed to load settings. The file may be corrupt or in the wrong format.");
            }
        } finally {
            event.target.value = null;
        }
    };
    reader.readAsText(file);
}

// Wire up the event listeners for the save/load buttons
export function wireSaveLoadEvents() {
    document.getElementById('saveSettings')?.addEventListener('click', saveStateToFile);
    document.getElementById('loadSettings')?.addEventListener('change', loadStateFromFile);
}