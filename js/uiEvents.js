// js/uiEvents.js 
// Version 1.1.1
// This module serves as the central hub for handling all user interactions.
// It attaches event listeners to UI elements and calls the appropriate business logic
// from other modules in response to user actions (e.g., clicks, changes).

import { state } from './state.js';
import { gatherConfigFromUI } from './config.js';
import { calculateDetailedSizing, runSimulation } from './analysis.js';
import { renderResults, renderSizingResults, drawDistributionCharts } from './uiRender.js';
import { getNumericInput, getSimulationData, displayError, clearError, parseRangesToHours } from './utils.js';
import { handleUsageCsv, handleSolarCsv } from './dataParser.js';
import { wireSaveLoadEvents } from './storage.js';
import { hideAllDebugContainers, renderDebugDataTable, renderExistingSystemDebugTable, renderProvidersDebugTable, renderAnalysisPeriodDebugTable, renderLoanDebugTable, renderOpportunityCostDebugTable } from './debugTables.js';
import { saveProvider, deleteProvider, getProviders, saveAllProviders } from './providerManager.js';
import { renderProviderSettings } from './uiDynamic.js';

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

    // Save import rule rows
    providerToSave.importRules = [];
    providerDetailsContainer.querySelectorAll('.import-rules-container .rule-row').forEach(row => {
        const rule = {};
        row.querySelectorAll('.provider-input[data-field]').forEach(input => {
            const field = input.dataset.field;
            if (input.type === 'number') rule[field] = parseFloat(input.value) || 0;
            else rule[field] = input.value;
        });
        providerToSave.importRules.push(rule);
    });
    
    // Save export rule rows
    providerToSave.exportRules = [];
    providerDetailsContainer.querySelectorAll('.export-rules-container .rule-row').forEach(row => {
        const rule = {};
        row.querySelectorAll('.provider-input[data-field]').forEach(input => {
            const field = input.dataset.field;
            if (input.type === 'number') rule[field] = parseFloat(input.value) || 0;
            else rule[field] = input.value;
        });
        providerToSave.exportRules.push(rule);
    });

    // Save special condition rows
    providerToSave.specialConditions = [];
    providerDetailsContainer.querySelectorAll('.conditions-container .rule-row').forEach(row => {
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
    const isDisabled = noSolarCheckbox.checked;

    if (solarCsvLabel) solarCsvLabel.style.display = isDisabled ? 'none' : 'block';
    if (existingSolarKWInput) existingSolarKWInput.disabled = isDisabled;
    if (existingSolarInverterInput) existingSolarInverterInput.disabled = isDisabled;
    
    // If no solar, clear inputs and generate a "zero solar" dataset for the simulation
    if (isDisabled) {
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
    } else {
        if (solarCounts) solarCounts.textContent = '';
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
    document.getElementById('enableLoan')?.addEventListener('change', (e) => {
        document.getElementById('loanSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('enableDiscountRate')?.addEventListener('change', (e) => {
        document.getElementById('discountRateSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
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
}

/**
 * Wires up event listeners for the dynamically generated provider settings UI.
 * It uses event delegation on the main container for efficiency.
 */
export function wireDynamicProviderEvents() {
    const providerContainer = document.getElementById('provider-settings-container');
    if (!providerContainer) return;
    
    // Listener for dropdown changes to show/hide conditional fields in rule rows
    providerContainer.addEventListener('change', (event) => {
        const target = event.target;
        if (target.matches('select[data-field="type"]')) {
            const parent = target.closest('.rule-row-content');
            if (parent) {
                const hoursWrapper = parent.querySelector('.hours-input-wrapper');
                const limitWrapper = parent.querySelector('.limit-input-wrapper');
                const selectedType = target.value;
                if (hoursWrapper) hoursWrapper.style.display = selectedType === 'tou' ? '' : 'none';
                if (limitWrapper) limitWrapper.style.display = selectedType === 'tiered' ? '' : 'none';
            }
        }
    });

    // Main delegated listener for all button clicks within the provider container
    providerContainer.addEventListener('click', (event) => {
        const target = event.target;
        let providers = getProviders();
        const updateAndRender = () => { saveAllProviders(providers); renderProviderSettings(); };

        // Handle "Add Rule" (Import or Export)
        if (target.matches('.add-rule-button')) {
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId); // Save pending changes before re-rendering
            providers = getProviders();
            const ruleType = target.dataset.type;
            const provider = providers.find(p => p.id === providerId);
            if (provider) {
                const newRule = { type: 'flat', name: 'New Rule', rate: 0 };
                const rulesKey = ruleType === 'import' ? 'importRules' : 'exportRules';
                if (!Array.isArray(provider[rulesKey])) { provider[rulesKey] = []; }
                provider[rulesKey].push(newRule);
                updateAndRender();
            }
        }
        
        // Handle provider-specific "Save Changes"
        if (target.matches('.save-provider-button')) {
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId);
            const statusEl = document.getElementById(`save-status-${providerId.toLowerCase()}`);
            if (statusEl) {
                statusEl.textContent = "Saved!";
                setTimeout(() => { statusEl.textContent = ""; }, 2000);
            }
        }

        // Handle provider reordering
        if (target.matches('.move-provider-up, .move-provider-down')) {
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
                providers = providers.filter(p => p.id !== providerId);
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
                if (provider[rulesKey]) { provider[rulesKey].splice(ruleIndex, 1); updateAndRender(); }
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
            const providerId = target.dataset.id;
            saveProviderFromDOM(providerId);
            providers = getProviders();
            const provider = providers.find(p => p.id === providerId);
            if (provider && provider.specialConditions) {
                const ruleIndex = parseInt(target.dataset.index, 10);
                provider.specialConditions.splice(ruleIndex, 1);
                updateAndRender();
            }
        }
    });

    // Listener for saving the open/closed state of a provider section
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
        // FIX 1: Clear the quarterly averages cache at the start of every run.
        state.quarterlyAverages = null; 

        const config = gatherConfigFromUI();
        const recommendationSection = document.getElementById('sizing-recommendation-section');
        if (recommendationSection) recommendationSection.style.display = 'none';

        // Validation checks
        if (config.useManual || !Array.isArray(state.electricityData) || state.electricityData.length === 0) {
            displayError("Detailed sizing requires an electricity CSV file to be uploaded.", "sizing-error-message");
            return;
        }
        if (!config.noExistingSolar && (!Array.isArray(state.solarData) || state.solarData.length === 0)) {
            displayError("Detailed sizing requires a solar CSV file. If you don't have one, check the 'No existing solar system' box.", "sizing-error-message");
            return;
        }

        const recommendationContainer = document.getElementById('recommendationContainer');
        if (recommendationContainer) recommendationContainer.innerHTML = '<p>Calculating...</p>';
        if (recommendationSection) recommendationSection.style.display = 'block';
        
        // Use a timeout to allow the UI to update with "Calculating..." before the main work begins.
        setTimeout(() => {
            let correctedElectricityData = JSON.parse(JSON.stringify(state.electricityData));
            
            const baselineProviderId = config.selectedProviders[0];
            if (!baselineProviderId) {
                displayError("Please select at least one provider to use as a baseline.", "sizing-error-message");
                return;
            }
            const baselineProvider = config.providers.find(p => p.id === baselineProviderId);
            if (!baselineProvider) {
                displayError("Could not find details for the selected baseline provider.", "sizing-error-message");
                return;
            }

            // Determine the Time-of-Use hours from the baseline provider's tariff rules.
            const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
            const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
            let touHours = {
                peak: parseRangesToHours(peakRule?.hours || ''),
                shoulder: parseRangesToHours(shoulderRule?.hours || ''),
            };

            // FIX 2: If no TOU rules are found, apply a full set of sensible defaults.
            if (touHours.peak.length === 0 && touHours.shoulder.length === 0) {
                touHours.peak = parseRangesToHours('3pm-11pm');
                touHours.shoulder = parseRangesToHours('7am-3pm');
            }

            // Save the determined hours to the global state for the debug table to use.
            state.touHoursForAnalysis = touHours;
            
            // Get or calculate the seasonal data needed for the simulation.
            const simulationData = config.useManual 
                ? config.manualData 
                : getSimulationData(touHours, correctedElectricityData);
            if (!simulationData) {
                displayError("Could not get seasonal data. Please check CSV or manual inputs.", "sizing-error-message");
                return;
            }
            // Run the detailed sizing calculation and render the results.
            const sizingResults = calculateDetailedSizing(correctedElectricityData, state.solarData, config, simulationData);
            if (sizingResults) {
                renderSizingResults(sizingResults, state);
                setTimeout(() => {
                    drawDistributionCharts(sizingResults.distributions, state);
                }, 0);
            } else {
                displayError("Sizing calculation failed. Please check the data files.", "sizing-error-message");
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

                // Determine the Time-of-Use hours from the baseline provider's tariff rules.
                const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
                const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
                let touHours = {
                    peak: parseRangesToHours(peakRule?.hours || ''),
                    shoulder: parseRangesToHours(shoulderRule?.hours || ''),
                };

                // FIX 2: If no TOU rules are found, apply a full set of sensible defaults.
                if (touHours.peak.length === 0 && touHours.shoulder.length === 0) {
                    console.log("No TOU rules found for provider. Applying default Peak (3pm-11pm) and Shoulder (7am-3pm) periods for analysis.");
                    touHours.peak = parseRangesToHours('3pm-11pm');
                    touHours.shoulder = parseRangesToHours('7am-3pm');
                }
                
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