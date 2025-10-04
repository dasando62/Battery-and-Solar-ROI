// js/uiEvents.js 
// Version 1.0.7
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

function setNestedProperty(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}

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
    if (isDisabled) {
        if (solarCsvInput) solarCsvInput.value = null;
        if (solarCounts) solarCounts.textContent = '';
        if (existingSolarKWInput) existingSolarKWInput.value = '0';
        if (existingSolarInverterInput) existingSolarInverterInput.value = '0';
        if (state.electricityData && state.electricityData.length > 0) {
            state.solarData = state.electricityData.map(day => ({
                date: day.date,
                hourly: Array(24).fill(0)
            }));
            if (solarCounts) solarCounts.textContent = `${state.solarData.length} days of zero-solar data generated.`;
        } else {
            state.solarData = null;
        }
    } else {
        if (solarCounts) solarCounts.textContent = '';
    }
}

export function wireStaticEvents() {
    document.getElementById('noExistingSolar')?.addEventListener('change', toggleExistingSolar);
    document.getElementById('manualInputToggle')?.addEventListener('change', (e) => {
        document.getElementById('csvInputSection').style.display = e.target.checked ? 'none' : 'block';
        document.getElementById('manualInputSection').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('debugToggle')?.addEventListener('change', (e) => {
        const display = e.target.checked ? 'inline-block' : 'none';
        document.querySelectorAll('.debug-button').forEach(button => button.style.display = display);
        if (!e.target.checked) {
			hideAllDebugContainers();
			clearError();
		}
    });
    document.getElementById("usageCsv")?.addEventListener("change", handleUsageCsv);
    document.getElementById("solarCsv")?.addEventListener("change", handleSolarCsv);
	wireSaveLoadEvents(); // This is now handled in storage.js
    document.getElementById('calculateSizing')?.addEventListener('click', handleCalculateSizing);
    document.getElementById('runAnalysis')?.addEventListener('click', handleRunAnalysis);
    document.getElementById('enableBlackoutSizing')?.addEventListener('change', (e) => {
        document.getElementById('blackoutSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('enableLoan')?.addEventListener('change', (e) => {
        document.getElementById('loanSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('enableDiscountRate')?.addEventListener('change', (e) => {
        document.getElementById('discountRateSettingsContainer').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('showRawDataDebug')?.addEventListener('click', (e) => {
        const container = document.getElementById('raw-data-debug-container');
        if (container) {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? 'block' : 'none';
            e.target.textContent = isHidden ? 'Hide Raw Data Tables' : 'Show Raw Data Tables';
        }
    });
    document.getElementById('add-provider-button')?.addEventListener('click', () => {
        const newProvider = { name: "New Provider", id: `custom_${Date.now()}`, importComponent: 'TIME_OF_USE_IMPORT', exportComponent: 'FLAT_RATE_FIT', exportType: 'flat', gridChargeEnabled: false, gridChargeStart: 23, gridChargeEnd: 5 };
        saveProvider(newProvider);
        renderProviderSettings();
    });
    document.getElementById("showDataDebugTable")?.addEventListener("click", () => renderDebugDataTable(state));
    document.getElementById("showExistingSystemDebugTable")?.addEventListener("click", () => renderExistingSystemDebugTable(state));
    document.getElementById("showProvidersDebugTable")?.addEventListener("click", () => renderProvidersDebugTable(state));
    document.getElementById("showAnalysisPeriodDebugTable")?.addEventListener("click", renderAnalysisPeriodDebugTable);
    document.getElementById("showLoanDebugTable")?.addEventListener("click", renderLoanDebugTable);
    document.getElementById("showOpportunityCostDebugTable")?.addEventListener("click", renderOpportunityCostDebugTable);
}

export function wireDynamicProviderEvents() {
    const providerContainer = document.getElementById('provider-settings-container');
    if (!providerContainer) return;

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

    // Main listener for all button clicks within the provider sections
    providerContainer.addEventListener('click', (event) => {
        const target = event.target;
        let providers = getProviders();

        // Helper function to save all provider data and then re-render the UI
        const updateAndRender = () => {
            saveAllProviders(providers);
            renderProviderSettings();
        };

        // --- MOVE PROVIDER UP/DOWN ---
        if (target.matches('.move-provider-up, .move-provider-down')) {
            const index = parseInt(target.dataset.index, 10);
            const direction = target.classList.contains('move-provider-up') ? 'up' : 'down';
            
            if (direction === 'up' && index > 0) {
                [providers[index], providers[index - 1]] = [providers[index - 1], providers[index]];
            } else if (direction === 'down' && index < providers.length - 1) {
                [providers[index], providers[index + 1]] = [providers[index + 1], providers[index]];
            }
            updateAndRender();
        }

        // --- DELETE PROVIDER ---
        if (target.matches('.delete-provider-button')) {
            const providerId = target.dataset.id;
            if (confirm(`Are you sure you want to delete this provider?`)) {
                providers = providers.filter(p => p.id !== providerId);
                updateAndRender();
            }
        }

        // --- ADD TARIFF RULE ---
        if (target.matches('.add-rule-button')) {
            const providerId = target.dataset.id;
            const ruleType = target.dataset.type;
            const provider = providers.find(p => p.id === providerId);

            if (provider) {
                const newRule = { type: 'flat', name: 'New Rule', rate: 0 };
                const rulesArray = ruleType === 'import' ? provider.importRules : provider.exportRules;
                rulesArray.push(newRule);
                updateAndRender();
            }
        }

        // --- REMOVE TARIFF RULE ---
        if (target.matches('.remove-rule-button')) {
            const providerId = target.closest('.provider-details').dataset.providerId;
            const ruleType = target.dataset.type;
            const ruleIndex = parseInt(target.dataset.index, 10);
            const provider = providers.find(p => p.id === providerId);

            if (provider) {
                const rulesArray = ruleType === 'import' ? provider.importRules : provider.exportRules;
                rulesArray.splice(ruleIndex, 1);
                updateAndRender();
            }
        }
        
        // --- ADD SPECIAL CONDITION ---
        if (target.matches('.add-condition-button')) {
            const providerId = target.dataset.id;
            const provider = providers.find(p => p.id === providerId);
            if (provider) {
                const newCondition = {
                    name: 'New Condition',
                    condition: { metric: 'peak_import', operator: 'less_than', value: 1 },
                    action: { type: 'flat_credit', value: 0.10 }
                };
                if (!provider.specialConditions) {
                    provider.specialConditions = [];
                }
                provider.specialConditions.push(newCondition);
                updateAndRender();
            }
        }

        // --- REMOVE SPECIAL CONDITION ---
        if (target.matches('.remove-condition-button')) {
            const providerId = target.dataset.id;
            const ruleIndex = parseInt(target.dataset.index, 10);
            const provider = providers.find(p => p.id === providerId);
            if (provider && provider.specialConditions) {
                provider.specialConditions.splice(ruleIndex, 1);
                updateAndRender();
            }
        }

        // --- SAVE ALL PROVIDER CHANGES ---
        if (target.matches('.save-provider-button')) {
            const providerId = target.dataset.id;
            const providerDetailsContainer = document.querySelector(`.provider-details[data-provider-id="${providerId}"]`);
            const providerToSave = providers.find(p => p.id === providerId);
            
            if (!providerToSave || !providerDetailsContainer) return;

            // Save top-level fields
            providerDetailsContainer.querySelectorAll('.provider-input[data-field]').forEach(input => {
                const field = input.dataset.field;
                if (input.closest('.rule-row')) return;

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
                    
                    if (input.type === 'number') {
                        value = parseFloat(value) || 0;
                    } else if (field === 'months') {
                        value = value.split(',').map(m => parseInt(m.trim(), 10)).filter(Number.isInteger);
                    }
                    
                    setNestedProperty(condition, field, value);
                });
                providerToSave.specialConditions.push(condition);
            });

            saveProvider(providerToSave);
            
            const statusEl = document.getElementById(`save-status-${providerId.toLowerCase()}`);
            if (statusEl) {
                statusEl.textContent = "Saved!";
                setTimeout(() => { statusEl.textContent = ""; }, 2000);
            }
        }
    });
}

function handleCalculateSizing() {
    try {
        clearError();
        const config = gatherConfigFromUI();
        const recommendationSection = document.getElementById('sizing-recommendation-section');
        if (recommendationSection) recommendationSection.style.display = 'none';

        // --- SAFETY CHECK 1: Ensure required CSV data exists ---
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
        
        setTimeout(() => {
            let correctedElectricityData = JSON.parse(JSON.stringify(state.electricityData));
            // ... (data correction logic is fine) ...

            // --- SAFETY CHECK 2: Ensure a valid baseline provider exists ---
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

            // --- SAFETY CHECK 3 & 4: Safely access rules and their properties ---
            const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
            const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));

            const touHours = {
                peak: parseRangesToHours(peakRule?.hours || ''),
                shoulder: parseRangesToHours(shoulderRule?.hours || ''),
            };
            
            // --- SAFETY CHECK 5: Ensure subsequent calculations succeed ---
            const simulationData = config.useManual 
                ? config.manualData 
                : getSimulationData(touHours, correctedElectricityData);
            if (!simulationData) {
                displayError("Could not get seasonal data. Please check CSV or manual inputs.", "sizing-error-message");
                return;
            }
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

function handleRunAnalysis() {
    setTimeout(() => {
        try {
            clearError();
            const config = gatherConfigFromUI();
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
			// Correctly find the baseline provider using its ID
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

			// Search the importRules array to find the hours
			const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
			const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));

			const touHours = {
				peak: parseRangesToHours(peakRule?.hours || ''),
				shoulder: parseRangesToHours(shoulderRule?.hours || ''),
			};
			simulationData = getSimulationData(touHours, state.electricityData);
            }
            if (!simulationData) {
                displayError("Could not calculate seasonal averages. Please check your data.", "data-input-error");
                return;
            }
            const resultsObject = runSimulation(config, simulationData, state.electricityData);
            renderResults(resultsObject);
            state.analysisResults = resultsObject.financials;
            state.analysisConfig = resultsObject.config;
            state.rawData = resultsObject.rawData;
        } catch (error) {
            console.error("An error occurred during analysis:", error);
            displayError("An unexpected error occurred during analysis. Check the console.", "run-analysis-error");
        }
    }, 0);
}