// js/uiEvents.js 
// Version 1.2.9
// This module serves as the central hub for handling all user interactions.
// It attaches event listeners to UI elements and calls the appropriate business logic
// from other modules in response to user actions (e.g., clicks, changes).

/*
 * Home Battery & Solar ROI Analyser
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

import { state } from './state.js';
import { gatherConfigFromUI } from './config.js';
import { calculateDetailedSizing, runSimulation, calculateSizingRecommendations } from './analysis.js';
import { renderResults, renderSizingResults, drawDistributionCharts } from './uiRender.js';
import { getNumericInput, getSimulationData, displayError, clearError, parseRangesToHours, determineTouHours } from './utils.js';
import { handleUsageCsv, handleSolarCsv } from './dataParser.js';
import { wireSaveLoadEvents } from './storage.js';
import { hideAllDebugContainers, renderDebugDataTable, renderExistingSystemDebugTable, renderProvidersDebugTable, renderAnalysisPeriodDebugTable, renderLoanDebugTable, renderOpportunityCostDebugTable } from './debugTables.js';
import { saveProvider, deleteProvider, getProviders, saveAllProviders, initializeDefaultProviders  } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';
import { LOCAL_STORAGE_KEYS, TARIFF_RULE_TYPES } from './constants.js';

// a variable to cache the satet of the solar data
let solarDataCache = null;

/**
 * Checks which debug tables are currently visible and re-renders them.
 * This is useful after running a new analysis to ensure the debug info is up-to-date.
 */
function refreshVisibleDebugTables() {
    if (!document.getElementById("debugToggle")?.checked) { return; }
    console.log("Refreshing visible debug tables...");
    if (document.getElementById('dataDebugTableContainer')?.style.display !== 'none') { renderDebugDataTable(state); }
    if (document.getElementById('existingSystemDebugTableContainer')?.style.display !== 'none') { renderExistingSystemDebugTable(state); }
    if (document.getElementById('providersDebugTableContainer')?.style.display !== 'none') { renderProvidersDebugTable(state); }
    if (document.getElementById('analysisPeriodDebugTableContainer')?.style.display !== 'none') { renderAnalysisPeriodDebugTable(); }
    if (document.getElementById('loanDebugTableContainer')?.style.display !== 'none') { renderLoanDebugTable(); }
    if (document.getElementById('opportunityCostDebugTableContainer')?.style.display !== 'none') { renderOpportunityCostDebugTable(); }
}

/**
 * A utility to safely set a value on a nested property within an object.
 * e.g., setNestedProperty(obj, 'condition.action.type', 'flat_credit').
 * @param {object} obj - The object to modify.
 * @param {string} path - The dot-notation path to the property.
 * @param {*} value - The value to set.
 */
function setNestedProperty(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') { current[keys[i]] = {}; }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}

/**
 * Reads all the current values from a provider's UI section in the DOM
 * and saves them to the provider object in localStorage.
 * @param {string} providerId - The ID of the provider to save.
 */
/**
 * Reads all the current values from a provider's UI section in the DOM
 * and saves them to the provider object in localStorage.
 * @param {string} providerId - The ID of the provider to save.
 */
function saveProviderFromDOM(providerId) {
    let providers = getProviders();
    const providerToSave = providers.find(p => p.id === providerId);
    const providerDetailsContainer = document.querySelector(`.provider-details[data-provider-id="${providerId}"]`);
    if (!providerToSave || !providerDetailsContainer) return;

    // Save top-level fields (name, dailyCharge, etc.)
    providerDetailsContainer.querySelectorAll('.provider-input[data-field]').forEach(input => {
        const field = input.dataset.field;
        if (input.closest('.rule-row')) return; // Skip inputs within rule rows
        if (input.type === 'checkbox') providerToSave[field] = input.checked;
        else if (input.type === 'number') providerToSave[field] = parseFloat(input.value) || 0;
        else providerToSave[field] = input.value;
    });

    // Save import rule rows (using a more specific selector to avoid conflicts)
    providerToSave.importRules = [];
    providerDetailsContainer.querySelectorAll('.import-rules-container .rule-row:not(.condition-row):not(.ev-rule-row)').forEach(row => {
        const rule = {};
        row.querySelectorAll('.provider-input[data-field]').forEach(input => {
            const field = input.dataset.field;
            if (input.type === 'number') rule[field] = parseFloat(input.value) || 0;
            else rule[field] = input.value;
        });
        providerToSave.importRules.push(rule);
    });
    
    // Save export rule rows (also using a more specific selector)
    providerToSave.exportRules = [];
    providerDetailsContainer.querySelectorAll('.export-rules-container .rule-row:not(.condition-row):not(.ev-rule-row)').forEach(row => {
        const rule = {};
        row.querySelectorAll('.provider-input[data-field]').forEach(input => {
            const field = input.dataset.field;
            if (input.type === 'number') rule[field] = parseFloat(input.value) || 0;
            else rule[field] = input.value;
        });
        providerToSave.exportRules.push(rule);
    });

    // --- THE FIX IS HERE ---
    // Save special condition rows using the unique '.condition-row' class.
    providerToSave.specialConditions = [];
    providerDetailsContainer.querySelectorAll('.conditions-container .condition-row').forEach(row => {
        const condition = {};
        row.querySelectorAll('.provider-input[data-field]').forEach(input => {
            const field = input.dataset.field;
            let value = input.value;
            if (input.type === 'number') value = parseFloat(value) || 0;
            else if (field === 'months') value = value.split(',').map(m => parseInt(m.trim(), 10)).filter(Number.isInteger);
            setNestedProperty(condition, field, value);
        });
        providerToSave.specialConditions.push(condition);
    });

    // Save EV charging rule rows using the unique '.ev-rule-row' class.
    providerToSave.evRules = [];
    providerDetailsContainer.querySelectorAll('.ev-rules-container .ev-rule-row').forEach(row => {
        const rule = {};
        row.querySelectorAll('.provider-input[data-field]').forEach(input => {
            const field = input.dataset.field;
            rule[field] = input.value;
        });
        providerToSave.evRules.push(rule);
    });

    // Specifically find the notes textarea to save its resized dimensions
    const notesTextarea = providerDetailsContainer.querySelector('textarea[data-field="notes"]');
    if (notesTextarea) {
        providerToSave.noteHeight = notesTextarea.style.height;
        providerToSave.noteWidth = notesTextarea.style.width;
    }

    saveProvider(providerToSave);
}

/**
 * Toggles the UI state related to the solar CSV upload based on whether
 * the "No existing solar system" checkbox is checked.
 */
export function toggleExistingSolar() {
    const noSolarCheckbox = document.getElementById('noExistingSolar');
    if (!noSolarCheckbox) return;
    
    const solarCsvLabel = document.getElementById('solarCsvLabel');
    const solarCsvInput = document.getElementById('solarCsv');
    const solarCounts = document.getElementById('solarCounts');
    const existingSolarKWInput = document.getElementById('existingSolarKW');
    const existingSolarInverterInput = document.getElementById('existingSolarInverter');
    const advancedSolarOptions = document.getElementById('advanced-solar-options');
    const isDisabled = noSolarCheckbox.checked;

    if (solarCsvLabel) solarCsvLabel.style.display = isDisabled ? 'none' : 'block';
    if (advancedSolarOptions) advancedSolarOptions.style.display = isDisabled ? 'none' : 'block';
    if (existingSolarKWInput) existingSolarKWInput.disabled = isDisabled;

    // --- FIX: Logic when CHECKING the box ---
    if (isDisabled) {
        // Only cache the data if it exists and hasn't been cached already
        if (state.solarData && solarDataCache === null) {
            solarDataCache = state.solarData; 
        }

        // Clear UI and generate zero-solar data
        if (solarCsvInput) solarCsvInput.value = null;
        if (solarCounts) solarCounts.textContent = '';
        if (existingSolarKWInput) existingSolarKWInput.value = '0';
        if (existingSolarInverterInput) existingSolarInverterInput.value = '0';

        if (state.electricityData && state.electricityData.length > 0) {
            state.solarData = state.electricityData.map(day => ({ date: day.date, hourly: Array(24).fill(0) }));
            if (solarCounts) solarCounts.textContent = `${state.solarData.length} days of zero-solar data generated.`;
        } else {
            state.solarData = null;
        }
    // --- FIX: Logic when UNCHECKING the box ---
    } else { 
        // Restore the original data from the cache
        state.solarData = solarDataCache;
        solarDataCache = null; // Clear the cache

        // Update the UI to reflect the restored data
        if (solarCounts) {
            solarCounts.textContent = state.solarData ? `${state.solarData.length} days of solar data loaded.` : '';
        }
    }
}

/**
 * Wires up event listeners for all static UI elements that exist on page load.
 */
export function wireStaticEvents() {
    document.getElementById('noExistingSolar')?.addEventListener('change', toggleExistingSolar);
    // Toggle between CSV and Manual input sections
    document.getElementById('manualInputToggle')?.addEventListener('change', (e) => {
        document.getElementById('csvInputSection').style.display = e.target.checked ? 'none' : 'block';
        document.getElementById('manualInputSection').style.display = e.target.checked ? 'block' : 'none';
    });
    // Toggle visibility of all debug-related buttons and containers
    document.getElementById('debugToggle')?.addEventListener('change', (e) => {
        const display = e.target.checked ? 'inline-block' : 'none';
        document.querySelectorAll('.debug-button').forEach(button => button.style.display = display);
        if (!e.target.checked) { hideAllDebugContainers(); clearError(); }
    });
	
	// Listener for the grid off-peak charging toggle
	const gridChargeToggle = document.getElementById('gridOffPeakCharge');
	const gridChargeSettings = document.getElementById('gridChargeSettingsContainer');

	const handleGridChargeToggle = () => {
		if (gridChargeSettings) {
			gridChargeSettings.style.display = gridChargeToggle.checked ? 'block' : 'none';
		}
	};

	gridChargeToggle?.addEventListener('change', handleGridChargeToggle);
	// Call it once on page load to set the initial state
	handleGridChargeToggle();

    // File input listeners
    document.getElementById("usageCsv")?.addEventListener("change", handleUsageCsv);
    document.getElementById("solarCsv")?.addEventListener("change", handleSolarCsv);
	wireSaveLoadEvents(); // Attach save/load button listeners
    
    // Main action button listeners
    document.getElementById('calculateSizing')?.addEventListener('click', handleCalculateSizing);
    document.getElementById('runAnalysis')?.addEventListener('click', handleRunAnalysis);
    
    // Listeners for collapsible sub-settings sections
    document.getElementById('enableBlackoutSizing')?.addEventListener('change', (e) => {
        document.getElementById('blackoutSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
	
    // Listener for the EV Charging toggle
    const evToggle = document.getElementById('enableEVCharging');
    const evSettings = document.getElementById('evSettingsContainer');
    const handleEVToggle = () => {
        if(evSettings) evSettings.style.display = evToggle.checked ? 'block' : 'none';
    };
    evToggle?.addEventListener('change', handleEVToggle);
    handleEVToggle(); // Set initial state on page load	
	
    document.getElementById('enableLoan')?.addEventListener('change', (e) => {
        document.getElementById('loanSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('enableDiscountRate')?.addEventListener('change', (e) => {
        document.getElementById('discountRateSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
	
    // Listener to reset all provider data to the application defaults
    document.getElementById('resetProviders')?.addEventListener('click', () => {
        if (confirm("Are you sure you want to delete all your providers and restore the application defaults? This cannot be undone.")) {
            // Remove the keys from localStorage
            localStorage.removeItem(LOCAL_STORAGE_KEYS.PROVIDERS);
            localStorage.removeItem(LOCAL_STORAGE_KEYS.DEFAULTS_LOADED);
 
            // Re-initialize and re-render
            initializeDefaultProviders();
            renderProviderSettings();
 
            // Let the user know it worked
            alert("Providers have been reset to their default configurations.");
        }
    });
	
    // Listener for the results-section debug toggle
    document.getElementById('showRawDataDebug')?.addEventListener('click', (e) => {
        const container = document.getElementById('raw-data-debug-container');
        if (container) {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? 'block' : 'none';
            e.target.textContent = isHidden ? 'Hide Raw Data Tables' : 'Show Raw Data Tables';
        }
    });
    // Listener to add a new provider
    document.getElementById('add-provider-button')?.addEventListener('click', () => {
        const newProvider = { name: "New Provider", id: `custom_${Date.now()}` };
        saveProvider(newProvider);
        renderProviderSettings();
    });

    // Listeners for all the individual debug table buttons
    document.getElementById("showDataDebugTable")?.addEventListener("click", () => renderDebugDataTable(state));
    document.getElementById("showExistingSystemDebugTable")?.addEventListener("click", () => renderExistingSystemDebugTable(state));
    document.getElementById("showProvidersDebugTable")?.addEventListener("click", () => renderProvidersDebugTable(state));
    document.getElementById("showAnalysisPeriodDebugTable")?.addEventListener("click", renderAnalysisPeriodDebugTable);
    document.getElementById("showLoanDebugTable")?.addEventListener("click", renderLoanDebugTable);
    document.getElementById("showOpportunityCostDebugTable")?.addEventListener("click", renderOpportunityCostDebugTable);
    
    // Logic for the NEM12 vs Advanced CSV format selection
    const formatNem12Radio = document.getElementById('formatNem12');
    const formatAdvancedRadio = document.getElementById('formatAdvanced');
    const advancedUsageOptions = document.getElementById('advanced-usage-options');

    const toggleAdvancedOptions = () => {
        if (advancedUsageOptions) {
            advancedUsageOptions.style.display = formatNem12Radio.checked ? 'none' : 'block';
        }
    };
    formatNem12Radio?.addEventListener('change', toggleAdvancedOptions);
    formatAdvancedRadio?.addEventListener('change', toggleAdvancedOptions);
	
    // Listener for the dynamically added 'Apply' buttons in the sizing section
    document.getElementById('sizing-recommendation-section')?.addEventListener('click', (event) => {
        const target = event.target;
        let solarInput, batteryInput, inverterInput;

        if (target.matches('.apply-simple-sizing') || target.matches('.apply-detailed-sizing')) {
            // Find the input fields
            solarInput = document.getElementById('newSolarKW');
            batteryInput = document.getElementById('newBattery');
            inverterInput = document.getElementById('newBatteryInverter');

            // Read data from the button's data attributes and update the fields
            if (batteryInput) batteryInput.value = target.dataset.battery;
            if (inverterInput) inverterInput.value = target.dataset.inverter;
            
            // Only the simple sizing button has a solar recommendation
            if (target.matches('.apply-simple-sizing') && solarInput) {
                solarInput.value = target.dataset.solar;
            }
 
            // Optional: Scroll to the new system section so the user sees the change
            solarInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
	
	// --- THE HYBRID INVERTER CHECKBOX LOGIC ---
    const hybridCheckbox = document.getElementById('isHybridInverter');
    const existingBatteryInverterInput = document.getElementById('existingBatteryInverter');

    const handleHybridToggle = () => {
        if (!hybridCheckbox || !existingBatteryInverterInput) return;
        
        if (hybridCheckbox.checked) {
            existingBatteryInverterInput.disabled = true;
            existingBatteryInverterInput.value = '0'; // Zero out the value for clarity
        } else {
            existingBatteryInverterInput.disabled = false;
        }
    };

    hybridCheckbox?.addEventListener('change', handleHybridToggle);
    // Call it once on page load to set the initial state
    handleHybridToggle();
    // --- END OF HYBRID INVERTER CHECKBOX LOGIC ---
}

/**
 * Wires up event listeners for the dynamically generated provider settings UI.
 * It uses a single, delegated event listener on the main container for efficiency.
 */
export function wireDynamicProviderEvents() {
    const providerContainer = document.getElementById('provider-settings-container');
    if (!providerContainer) return;

    // Listener for showing/hiding conditional inputs in rule rows
    providerContainer.addEventListener('change', (event) => {
        const target = event.target;
        if (target.matches('select[data-field="type"]')) {
            const parent = target.closest('.rule-row-content');
            if (parent) {
                const hoursWrapper = parent.querySelector('.hours-input-wrapper');
                const limitWrapper = parent.querySelector('.limit-input-wrapper');
                const selectedType = target.value;
                if (hoursWrapper) hoursWrapper.style.display = selectedType === TARIFF_RULE_TYPES.TIME_OF_USE ? '' : 'none';
                if (limitWrapper) limitWrapper.style.display = selectedType === TARIFF_RULE_TYPES.TIERED ? '' : 'none';
            }
        }
    });

    // Main delegated listener for all button clicks
    providerContainer.addEventListener('click', (event) => {
        const target = event.target;
        let providers; // Will be populated after saving
        const updateAndRender = () => { saveAllProviders(providers); renderProviderSettings(); };

        // Handle "Add Rule" (Import or Export)
        if (target.matches('.add-rule-button')) {
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId); // Save pending changes before re-rendering
            providers = getProviders();
            const ruleType = target.dataset.type;
            const provider = providers.find(p => p.id === providerId);
            if (provider) {
                const newRule = { type: TARIFF_RULE_TYPES.FLAT, name: 'New Rule', rate: 0 };
                const rulesKey = ruleType === 'import' ? 'importRules' : 'exportRules';
                if (!Array.isArray(provider[rulesKey])) { provider[rulesKey] = []; }
                provider[rulesKey].push(newRule);
                updateAndRender();
            }
        }
        
        // Handle "Apply Changes"
        if (target.matches('.save-provider-button')) {
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId);
            const statusEl = document.getElementById(`save-status-${providerId.toLowerCase()}`);
            if (statusEl) {
                statusEl.textContent = "Applied! Use main 'Save Settings' button to make permanent.";
                setTimeout(() => { statusEl.textContent = ""; }, 3000);
            }
        }

        // Handle reordering
        if (target.matches('.move-provider-up, .move-provider-down')) {
            providers = getProviders(); // Get current state first
            const index = parseInt(target.dataset.index, 10);
            const direction = target.classList.contains('move-provider-up') ? 'up' : 'down';
            if (direction === 'up' && index > 0) { [providers[index], providers[index - 1]] = [providers[index - 1], providers[index]]; }
            else if (direction === 'down' && index < providers.length - 1) { [providers[index], providers[index + 1]] = [providers[index + 1], providers[index]]; }
            updateAndRender();
        }

        // Handle "Delete Provider"
        if (target.matches('.delete-provider-button')) {
            const providerId = target.dataset.id;
            if (confirm(`Are you sure you want to delete this provider?`)) {
                providers = getProviders().filter(p => p.id !== providerId);
                updateAndRender();
            }
        }
        
        // Handle "Remove Rule"
        if (target.matches('.remove-rule-button')) {
            const providerId = target.closest('.provider-details').dataset.providerId;
            saveProviderFromDOM(providerId);
            providers = getProviders();
            const provider = providers.find(p => p.id === providerId);
            if (provider) {
                const ruleType = target.dataset.type;
                const ruleIndex = parseInt(target.dataset.index, 10);
                const rulesKey = ruleType === 'import' ? 'importRules' : 'exportRules';
                if (provider[rulesKey]) { 
                    provider[rulesKey].splice(ruleIndex, 1); 
                    updateAndRender(); 
                }
            }
        }
        
        // Handle "Add Condition"
        if (target.matches('.add-condition-button')) {
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId);
            providers = getProviders();
            const provider = providers.find(p => p.id === providerId);
            if (provider) {
                const newCondition = { name: 'New Condition', condition: { metric: 'peak_import', operator: 'less_than', value: 1 }, action: { type: 'flat_credit', value: 0.10 } };
                if (!provider.specialConditions) { provider.specialConditions = []; }
                provider.specialConditions.push(newCondition);
                updateAndRender();
            }
        }

        // Handle "Remove Condition"
        if (target.matches('.remove-condition-button')) {
            const providerId = target.closest('.provider-details').dataset.providerId;
            saveProviderFromDOM(providerId);
            providers = getProviders();
            const provider = providers.find(p => p.id === providerId);
            if (provider && provider.specialConditions) {
                const ruleIndex = parseInt(target.dataset.index, 10);
                provider.specialConditions.splice(ruleIndex, 1);
                updateAndRender();
            }
        }

        // Handle "Add EV Rule"
        if (target.matches('.add-ev-rule-button')) {
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId); // <-- THE FIX IS HERE
            providers = getProviders();      // <-- AND HERE
            const provider = providers.find(p => p.id === providerId);
            if (provider) {
                const newRule = { source: 'excess_solar', hours: '9am-4pm' };
                if (!Array.isArray(provider.evRules)) { provider.evRules = []; }
                provider.evRules.push(newRule);
                updateAndRender();
            }
        }

        // Handle "Remove EV Rule"
        if (target.matches('.remove-ev-rule-button')) {
            const providerId = target.closest('.provider-details').dataset.providerId;
            saveProviderFromDOM(providerId); // <-- THE FIX IS HERE
            providers = getProviders();      // <-- AND HERE
            const provider = providers.find(p => p.id === providerId);
            if (provider && provider.evRules) {
                const ruleIndex = parseInt(target.dataset.index, 10);
                provider.evRules.splice(ruleIndex, 1);
                updateAndRender();
            }
        }
    });

    // Listener for saving the open/closed state
    providerContainer.addEventListener('toggle', (event) => {
        const target = event.target;
        if (target.classList.contains('provider-details')) {
            const providerId = target.dataset.providerId;
            const isNowOpen = target.open;
            let providers = getProviders();
            const providerToUpdate = providers.find(p => p.id === providerId);
            if (providerToUpdate) {
                providerToUpdate.isExpanded = isNowOpen;
                saveAllProviders(providers);
            }
        }
    }, true);
}

/**
 * Handles the "Calculate Sizing Recommendation" button click.
 */
function handleCalculateSizing() {
    try {
        clearError();
        const config = gatherConfigFromUI();
        const recommendationSection = document.getElementById('sizing-recommendation-section');
        const recommendationContainer = document.getElementById('recommendationContainer');
        
        if (recommendationContainer) recommendationContainer.innerHTML = '<p>Calculating...</p>';
        if (recommendationSection) recommendationSection.style.display = 'block';

        // Use a timeout to allow the UI to update with "Calculating..." before the main work begins.
        setTimeout(() => {
            if (config.useManual) {
                // --- MANUAL MODE LOGIC ---
                // Gather the daily averages directly from the manual input fields.
                const simulationData = {
                    'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak") },
                    'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak") },
                    'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak") },
                    'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak") },
                };
                
                // Run only the simple (heuristic) sizing calculation.
                const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);

                // Create a simplified results object.
                const sizingResults = {
                    heuristic: heuristicRecs,
                    detailed: null, // Detailed results are not available in manual mode
                    blackout: null  // Blackout results are not available in manual mode
                };

                renderSizingResults(sizingResults, state, config);
                
                // Clear the area where the detailed charts would normally appear.
                const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
                if (newSystemEstimatesTable) {
                    newSystemEstimatesTable.innerHTML = '<p><em>Detailed sizing charts and blackout protection require CSV data.</em></p>';
                }

            } else {
                // --- CSV MODE LOGIC (the original logic with corrected validation) ---
                if (!Array.isArray(state.electricityData) || state.electricityData.length === 0) {
                    displayError("Detailed sizing requires an electricity CSV file to be uploaded.", "sizing-error-message");
                    return;
                }
                if (!config.noExistingSolar && (!Array.isArray(state.solarData) || state.solarData.length === 0)) {
                    displayError("Detailed sizing requires a solar CSV file. If you don't have one, check the 'No existing solar system' box.", "sizing-error-message");
                    return;
                }
                
                // Continue with the detailed sizing as before.
                let correctedElectricityData = JSON.parse(JSON.stringify(state.electricityData));
                const touHours = determineTouHours(config);
                state.touHoursForAnalysis = touHours;
                const simulationData = getSimulationData(touHours, correctedElectricityData);
                if (!simulationData) {
                    displayError("Could not get seasonal data. Please check CSV or manual inputs.", "sizing-error-message");
                    return;
                }
                const sizingResults = calculateDetailedSizing(correctedElectricityData, state.solarData, config, simulationData);
                if (sizingResults) {
                    renderSizingResults(sizingResults, state, config);
                    setTimeout(() => {
                        drawDistributionCharts(sizingResults.distributions, state);
                    }, 0);
                } else {
                    displayError("Sizing calculation failed. Please check the data files.", "sizing-error-message");
                }
            }
        }, 10);
    } catch (error) {
        console.error("Error during sizing calculation:", error);
        displayError("An unexpected error occurred during the sizing calculation.", "sizing-error-message");
    }
}

/**
 * Handles the "Run ROI Analysis" button click.
 */
function handleRunAnalysis() {
    // Use a timeout to allow the UI to update before the potentially long-running analysis starts.
    setTimeout(() => {
        try {
            clearError();
            // FIX 1: Clear the quarterly averages cache at the start of every run.
            state.quarterlyAverages = null;

            const config = gatherConfigFromUI();
            // Validation checks
            if (config.selectedProviders.length === 0) {
                displayError("Please select at least one provider to run the analysis.", "provider-selection-error");
                return;
            }
            let simulationData;
            if (config.useManual) {
                simulationData = config.manualData;
            } else {
                if (!state.electricityData || state.electricityData.length === 0) {
                    displayError("Please upload your electricity usage CSV to run the analysis.", "data-input-error");
                    return;
                }
                const baselineProviderId = config.selectedProviders[0];
                if (!baselineProviderId) {
                    displayError("Please select at least one provider to use as a baseline.", "provider-selection-error");
                    return;
                }
                const baselineProvider = config.providers.find(p => p.id === baselineProviderId);
                if (!baselineProvider) {
                    displayError("Could not find details for the selected baseline provider.", "provider-selection-error");
                    return;
                }
				
				// Determine the Time-of-Use hours using the new centralized function.
				const touHours = determineTouHours(config);
                // Save the determined hours to the global state for the debug table to use.
                state.touHoursForAnalysis = touHours;

                simulationData = getSimulationData(touHours, state.electricityData);
            }
            if (!simulationData) {
                displayError("Could not calculate seasonal averages. Please check your data.", "data-input-error");
                return;
            }

            // --- Run Simulation and Render Results ---
            const resultsObject = runSimulation(config, simulationData, state.electricityData);
            renderResults(resultsObject);
            // Store results in the global state for exporting
            state.analysisResults = resultsObject.financials;
            state.analysisConfig = resultsObject.config;
            state.rawData = resultsObject.rawData;
            // Refresh any open debug tables with the new analysis data.
			refreshVisibleDebugTables();
			
        } catch (error) {
            console.error("An error occurred during analysis:", error);
            displayError("An unexpected error occurred during analysis. Check the console.", "run-analysis-error");
        }
    }, 0);
}